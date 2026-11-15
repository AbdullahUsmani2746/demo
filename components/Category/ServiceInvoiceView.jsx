"use client";
// Service Invoice (tran_code 21) body of the voucher view modal (Table.jsx
// DataViewModal). The generic modal reads the Service ENTRY config (the
// invoice's sourceMapping type) and goods-voucher columns, so it showed raw
// account numbers and no service names; this lays out what a vendor's
// service bill actually is:
//   header  — date, vendor, vendor / ST invoice, GRN / dispatch ref, narration
//   links   — GET /api/service-invoice/links?tran_id= (lib/service/serviceInvoice.js)
//   lines   — sub_tran_id 1: service · expense account · qty · rate · amount · ST · total
//   posting — every ledger row: expense Dr (lines), vendor Cr + input tax Dr (sub_tran_id 3)
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link2, RefreshCw } from "lucide-react";
import { serviceInvoiceTotal, serviceInvoiceRef } from "./constants";

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round(num(n) * 100) / 100;
const fmt = (n) =>
  num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n) => num(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "");
const accountLabel = (acno, acname) =>
  [acno, acname].filter((v) => v !== null && v !== undefined && v !== "").join(" · ") || "—";

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="truncate text-sm font-medium text-gray-900">{children || "—"}</p>
    </div>
  );
}

function SectionTitle({ children, count }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{children}</p>
      {count != null && (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-600">
          {count}
        </span>
      )}
    </div>
  );
}

const th = "px-3 py-2 text-left text-xs font-semibold text-white whitespace-nowrap";
const thNum = "px-3 py-2 text-right text-xs font-semibold text-white whitespace-nowrap";
const td = "px-3 py-1.5 text-sm text-gray-900 border-t border-gray-200";
const tdNum = `${td} text-right font-mono tabular-nums whitespace-nowrap`;

export default function ServiceInvoiceView({ data }) {
  const tranId = Number(data?.tran_id) || null;
  const [links, setLinks] = useState({ loading: !!tranId, error: false, rows: [] });

  useEffect(() => {
    if (!tranId) return undefined;
    let cancelled = false;
    setLinks({ loading: true, error: false, rows: [] });
    axios
      .get("/api/service-invoice/links", { params: { tran_id: tranId } })
      .then((res) => {
        if (cancelled) return;
        setLinks({ loading: false, error: false, rows: Array.isArray(res.data?.links) ? res.data.links : [] });
      })
      .catch(() => {
        if (!cancelled) setLinks({ loading: false, error: true, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tranId]);

  const rows = Array.isArray(data?.transactions) ? data.transactions : [];
  const lines = rows.filter((t) => (t.sub_tran_id ?? 1) === 1);
  const autoRows = rows.filter((t) => t.sub_tran_id === 3);

  const priced = lines.map((t) => {
    const qty = num(t.qty) || 1;
    const gross = r2(t.gross_amount ?? t.damt ?? qty * num(t.rate));
    const tax = r2(t.st_amount);
    return { t, qty, gross, tax, total: r2(gross + tax) };
  });
  const sum = (key) => r2(priced.reduce((s, p) => s + p[key], 0));

  // Ledger: the expense lines are the debits the auto entries balance.
  const posting = [
    ...lines.map((t) => ({
      key: `l-${t.id}`,
      acno: t.acno,
      acname: t.acnoDetails?.acname,
      narration: t.serviceDetails?.service_name || t.narration1 || "Service",
      dr: num(t.damt),
      cr: num(t.camt),
    })),
    ...autoRows.map((t) => ({
      key: `a-${t.id}`,
      acno: t.acno,
      acname: t.acnoDetails?.acname,
      narration: String(t.narration1 || "").trim() === "Auto Entry" ? "Vendor" : t.narration1 || "Auto entry",
      dr: num(t.damt),
      cr: num(t.camt),
    })),
  ];
  const drTotal = r2(posting.reduce((s, p) => s + p.dr, 0));
  const crTotal = r2(posting.reduce((s, p) => s + p.cr, 0));

  const ref = serviceInvoiceRef(data);

  return (
    <>
      {/* ── Header ── */}
      <div className="border-b bg-gray-50/70 px-5 py-3">
        <SectionTitle>Invoice Details</SectionTitle>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Date">{fmtDate(data?.dated)}</Field>
          <div className="col-span-2 min-w-0 sm:col-span-1 lg:col-span-1">
            <Field label="Vendor">{accountLabel(data?.pycd, data?.acno?.acname)}</Field>
          </div>
          <Field label="Vendor Invoice No">{data?.invoice_no}</Field>
          <Field label="Ref">{ref}</Field>
          <Field label="ST Invoice No">{data?.check_no}</Field>
          <Field label="ST Invoice Date">{data?.check_no ? fmtDate(data?.check_date) : ""}</Field>
          {data?.godownDetails?.godown && <Field label="Godown">{data.godownDetails.godown}</Field>}
          <Field label="Invoice Total">{fmt(serviceInvoiceTotal(data))}</Field>
        </div>
        {data?.rmk && (
          <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/70">Narration</p>
            <p className="whitespace-pre-line text-sm text-amber-900">{data.rmk}</p>
          </div>
        )}
      </div>

      {/* ── Linked GRNs / dispatches ── */}
      <div className="border-b px-5 py-3">
        <SectionTitle count={links.loading || links.error ? null : links.rows.length}>
          Linked GRNs / Dispatches
        </SectionTitle>
        {links.loading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <RefreshCw className="h-3 w-3 animate-spin" /> Loading linked documents…
          </span>
        ) : links.error ? (
          <p className="text-xs text-red-600">Could not load the linked documents.</p>
        ) : links.rows.length === 0 ? (
          <p className="text-xs text-gray-500">No documents linked.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {links.rows.map((k) => (
              <span
                key={`${k.source_type}-${k.source_tran_id}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-1 pr-2 text-xs text-gray-800"
              >
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${
                    k.source_type === "GRN" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"
                  }`}
                >
                  {k.source_type === "GRN" ? "GRN" : "Dispatch"}
                </span>
                <Link2 className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
                <span className="truncate">{k.label || `${k.source_type} ${k.source_tran_id}`}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Service lines ── */}
      <div className="px-3 py-3">
        <div className="px-2">
          <SectionTitle count={priced.length}>Services</SectionTitle>
        </div>
        {priced.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">No service lines</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full border-collapse">
              <thead className="bg-primary">
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Service</th>
                  <th className={th}>Expense Account</th>
                  <th className={thNum}>Qty</th>
                  <th className={thNum}>Rate</th>
                  <th className={thNum}>Amount</th>
                  <th className={thNum}>ST</th>
                  <th className={thNum}>Total</th>
                </tr>
              </thead>
              <tbody>
                {priced.map(({ t, qty, gross, tax, total }, i) => (
                  <tr key={t.id ?? i} className="hover:bg-gray-50">
                    <td className={`${td} text-gray-500`}>{i + 1}</td>
                    <td className={`${td} font-medium`}>
                      {t.serviceDetails?.service_name || (t.service_id ? `Service ${t.service_id}` : "—")}
                    </td>
                    <td className={td}>{accountLabel(t.acno, t.acnoDetails?.acname)}</td>
                    <td className={tdNum}>{fmtQty(qty)}</td>
                    <td className={tdNum}>{fmt(t.rate)}</td>
                    <td className={tdNum}>{fmt(gross)}</td>
                    <td className={tdNum}>
                      {tax ? (
                        <>
                          {fmt(tax)}
                          <span className="ml-1 text-[11px] text-gray-500">
                            ({r2(num(t.st_rate) + num(t.additional_tax))}%)
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${tdNum} font-semibold`}>{fmt(total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td className={`${td} font-semibold`} colSpan={5}>
                    Total
                  </td>
                  <td className={`${tdNum} font-semibold`}>{fmt(sum("gross"))}</td>
                  <td className={`${tdNum} font-semibold`}>{fmt(sum("tax"))}</td>
                  <td className={`${tdNum} font-bold text-primary`}>{fmt(sum("total"))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Posting ── */}
      <div className="px-3 pb-3">
        <div className="px-2">
          <SectionTitle>Posting</SectionTitle>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Account</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">For</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Dr</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Cr</th>
              </tr>
            </thead>
            <tbody>
              {posting.map((p) => (
                <tr key={p.key}>
                  <td className={td}>{accountLabel(p.acno, p.acname)}</td>
                  <td className={`${td} text-gray-600`}>{p.narration}</td>
                  <td className={tdNum}>{p.dr ? fmt(p.dr) : ""}</td>
                  <td className={tdNum}>{p.cr ? fmt(p.cr) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td className={`${td} font-semibold`} colSpan={2}>
                  Total
                  {drTotal !== crTotal && (
                    <span className="ml-2 text-xs font-medium text-red-600">not balanced</span>
                  )}
                </td>
                <td className={`${tdNum} font-semibold`}>{fmt(drTotal)}</td>
                <td className={`${tdNum} font-semibold`}>{fmt(crTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
