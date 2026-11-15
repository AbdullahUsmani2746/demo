"use client";
// components/bi/DashboardPanels.jsx — the dashboard's side panels and dialogs:
//   WhyPanel        "Why did it change?" — a figure split by customer / item /
//                   sales person …, this period vs the one before (green rises,
//                   red falls); a row opens its records
//   InfoDialog      "How is this worked out?" — the question's description,
//                   its source, period and the filters in use
//   ApprovalsPanel  the person's Approvals inbox in a side panel: approve /
//                   reject (with a reason) without leaving the dashboard —
//                   the same inbox and rules as /dashboard/approvals
//   CustomizeDialog pin / hide / order cards and saved views — the person's own
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Trash2, X } from "lucide-react";
import { formatFull, formatValue } from "./format";
import { periodShort, periodTitle, rangeText, parsePeriod } from "@/lib/bi/periods";

function Shell({ open, onClose, title, subtitle, side = false, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="bi-panel-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        className={`bi-panel ${side ? "side" : ""} ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="bi-panel-head">
          <div className="min-w-0">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="bi-btn bi-btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="bi-panel-body">{children}</div>
        {footer && <div className="bi-panel-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ── Why did it change? ─────────────────────────────────────────────── */
export function WhyPanel({ open, onClose, dashboardId, item, period, filters, onDrillValue }) {
  const [fields, setFields] = useState([]);
  const [field, setField] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const qid = item?.questionId;

  useEffect(() => {
    if (!open || !qid) return;
    setData(null);
    setError(null);
    axios
      .get(`/api/bi/my/${dashboardId}/why`, { params: { questionId: qid } })
      .then(({ data: d }) => {
        setFields(d.fields || []);
        const pref = ["customer", "item", "sales_person", "category", "main_category"];
        setField((d.fields || []).find((f) => pref.includes(f.key))?.key ?? d.fields?.[0]?.key ?? null);
      })
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, [open, qid, dashboardId]);

  useEffect(() => {
    if (!open || !qid || !field) return;
    setLoading(true);
    setError(null);
    axios
      .post(`/api/bi/my/${dashboardId}/why`, {
        questionId: qid,
        period,
        field,
        filters: Object.entries(filters || {}).filter(([, v]) => v?.length).map(([f, value]) => ({ field: f, value })),
      })
      .then(({ data: d }) => setData(d))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [open, qid, field, period, filters, dashboardId]);

  const max = Math.max(1, ...(data?.rows || []).map((r) => Math.abs(r.diff)));
  const fmt = data?.measure?.format;
  const diffTotal = data ? data.total.cur - data.total.prev : 0;
  const p = parsePeriod(period);
  return (
    <Shell
      open={open}
      onClose={onClose}
      wide
      title={item?.name ? `Why did ${item.name.toLowerCase()} change?` : "Why did it change?"}
      subtitle={data ? `${periodTitle(period)} ${rangeText(p)} vs ${rangeText(p?.prev)}` : null}
    >
      {data && (
        <p className="bi-why-total num">
          {formatValue(data.total.prev, fmt)} → <b>{formatValue(data.total.cur, fmt)}</b>
          <span className={diffTotal >= 0 ? "up" : "down"}> {diffTotal >= 0 ? "▲" : "▼"} {formatValue(Math.abs(diffTotal), fmt)}</span>
        </p>
      )}
      {fields.length > 1 && (
        <div className="bi-seg bi-why-tabs" role="tablist" aria-label="Break down by">
          {fields.slice(0, 8).map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={f.key === field} className={f.key === field ? "active" : ""} onClick={() => setField(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      {error && <div className="bi-error">{error}</div>}
      {loading && !data && <div className="bi-skel" style={{ height: 260 }} />}
      {data && !data.rows.length && <div className="bi-empty">No change by {data.field.label.toLowerCase()} between the two periods.</div>}
      {data && data.rows.length > 0 && (
        <>
          <p className="bi-why-hint">What moved the number most — biggest rises and falls.</p>
          <div className="bi-why-rows">
            {data.rows.map((r) => (
              <button key={r.name} type="button" className="bi-why-row" disabled={r.other || !onDrillValue}
                onClick={() => onDrillValue?.(data.field.key, r.name)} title={`${formatFull(r.prev, fmt)} → ${formatFull(r.cur, fmt)}`}>
                <span className="name">{r.name}</span>
                <span className="track">
                  <span className="mid" />
                  <span className={`bar ${r.diff >= 0 ? "up" : "down"}`} style={{ width: `${(Math.abs(r.diff) / max) * 50}%` }} />
                </span>
                <span className={`fig num ${r.diff >= 0 ? "up" : "down"}`}>{r.diff >= 0 ? "+" : "−"}{formatValue(Math.abs(r.diff), fmt)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}

/* ── How is this worked out? ───────────────────────────────────────── */
export function InfoDialog({ open, onClose, item, period, filters, updatedAt }) {
  if (!item) return null;
  const opts = item.config?.visual?.options || {};
  const f = Object.entries(filters || {}).filter(([, v]) => v?.length);
  const p = parsePeriod(period);
  const pointInTime = item.result?.meta?.pointInTime;
  return (
    <Shell open={open} onClose={onClose} title={`How ${item.name} is worked out`}>
      <ul className="bi-info-list">
        <li>{item.description || "No description has been written for this figure yet — add one in the BI Designer."}</li>
        <li>{pointInTime ? "A balance as of now — the period does not change it." : `Period: ${periodTitle(period)}${p ? ` (${rangeText(p)})` : ""}, compared with ${rangeText(p?.prev)} and the same dates last year.`}</li>
        <li>Filters: {f.length ? f.map(([k, v]) => `${k === "book" ? "Book" : k}: ${v.join(", ")}`).join(" · ") : "none"} — and only what you are allowed to see.</li>
        {opts.monthlyTarget && <li>Target: {formatFull(opts.monthlyTarget, item.result?.columns?.find((c) => c.role === "measure")?.format)} a month, spread over the chosen days.</li>}
        {opts.goodWhen === "down" && <li>Lower is better for this figure (a fall shows green).</li>}
      </ul>
      <p className="bi-info-src">Source: {item.datasetLabel || "BI question"} · question “{item.name}”{updatedAt ? ` · updated ${updatedAt}` : ""}</p>
    </Shell>
  );
}

/* ── Approvals in a side panel ─────────────────────────────────────── */
export function ApprovalsPanel({ open, onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

  const load = () =>
    axios
      .get("/api/approvals/requests", { params: { box: "inbox" } })
      .then(({ data: d }) => setRows((d.data || []).filter((r) => r.can_decide)))
      .catch((e) => setError(e.response?.data?.error || e.message));
  useEffect(() => {
    if (open) {
      setRows(null);
      load();
    }
  }, [open]);

  async function decide(r, action, remarks) {
    setBusy(`${r.id}:${action}`);
    setError(null);
    try {
      await axios.post(`/api/approvals/requests/${r.id}`, { action, remarks });
      setRejecting(null);
      setReason("");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.response?.data?.error || e.response?.data?.message || e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell open={open} onClose={onClose} side title="Waiting for your approval" subtitle="The same inbox as Approvals — your own requests never show here"
      footer={<Link href="/dashboard/approvals" className="bi-link">Open the full Approvals inbox</Link>}>
      {error && <div className="bi-error">{error}</div>}
      {!rows && !error && <div className="bi-skel" style={{ height: 200 }} />}
      {rows && rows.length === 0 && <div className="bi-allclear">Nothing is waiting for you.</div>}
      {rows?.map((r) => (
        <article key={r.id} className="bi-appr">
          <div className="top">
            <div className="min-w-0">
              <span className="form">{r.form}{r.target_no ? ` · ${r.target_no}` : ""}</span>
              <b className="sum">{r.summary || r.rule_name}</b>
            </div>
          </div>
          <div className="meta">
            {r.rule_name && <span className="bi-pill bi-pill-warn">{r.rule_name}</span>}
            <span>by {r.requested_by_name} · {new Date(r.requested_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          {rejecting === r.id ? (
            <div className="reject">
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason — the requester sees it" aria-label="Reason for rejecting" />
              <div className="acts">
                <button type="button" className="bi-btn" onClick={() => setRejecting(null)}>Back</button>
                <button type="button" className="bi-btn bi-btn-danger" disabled={!reason.trim() || !!busy} onClick={() => decide(r, "reject", reason.trim())}>
                  {busy === `${r.id}:reject` ? <Loader2 size={14} className="animate-spin" /> : null} Reject
                </button>
              </div>
            </div>
          ) : (
            <div className="acts">
              <button type="button" className="bi-btn bi-btn-good" disabled={!!busy} onClick={() => decide(r, "approve")}>
                {busy === `${r.id}:approve` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
              </button>
              <button type="button" className="bi-btn bi-btn-danger-o" disabled={!!busy} onClick={() => setRejecting(r.id)}>Reject…</button>
              <Link className="bi-btn" href={`/dashboard/approvals?id=${r.id}`}>Open</Link>
            </div>
          )}
        </article>
      ))}
    </Shell>
  );
}

/* ── Customize: pin / hide / order, saved views ─────────────────────── */
export function CustomizeDialog({ open, onClose, layout, results, prefs, onSave, current }) {
  const [draft, setDraft] = useState(prefs);
  const [viewName, setViewName] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setDraft(prefs);
  }, [open, prefs]);

  const sections = useMemo(() => (layout?.sections ?? []).filter((s) => s.items?.length), [layout]);
  const hidden = new Set(draft?.hidden || []);
  const nameOf = (qid) => results?.[qid]?.name ?? `Question ${qid}`;
  const orderOf = (s) => {
    const ids = s.items.map((i) => i.questionId);
    const saved = draft?.order?.[s.id] || [];
    return [...saved.filter((q) => ids.includes(q)), ...ids.filter((q) => !saved.includes(q))];
  };
  const move = (s, i, dir) => {
    const list = orderOf(s);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setDraft((d) => ({ ...d, order: { ...(d.order || {}), [s.id]: list } }));
  };
  const toggle = (qid) =>
    setDraft((d) => ({ ...d, hidden: hidden.has(qid) ? d.hidden.filter((x) => x !== qid) : [...(d.hidden || []), qid] }));
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const views = [...(draft.views || []).filter((v) => v.name !== name), { name, ...current }];
    setDraft((d) => ({ ...d, views }));
    setViewName("");
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      title="Customize my dashboard"
      subtitle="Saved on your account — nobody else's dashboard changes"
      footer={
        <>
          <button type="button" className="bi-btn" onClick={() => setDraft({ hidden: [], order: {}, views: draft?.views || [], defaultView: draft?.defaultView ?? null })}>Reset cards</button>
          <button type="button" className="bi-btn bi-btn-primary" disabled={saving} onClick={save}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save</button>
        </>
      }
    >
      <section className="bi-cz">
        <h3>Saved views</h3>
        <p className="hint">A view remembers the period, Compare and the filters. Apply it from the View list in the toolbar.</p>
        <div className="views">
          {(draft?.views || []).map((v) => (
            <span key={v.name} className={`view ${draft.defaultView === v.name ? "def" : ""}`}>
              <button type="button" onClick={() => setDraft((d) => ({ ...d, defaultView: d.defaultView === v.name ? null : v.name }))}
                title={draft.defaultView === v.name ? "Opens by default — click to stop" : "Open with this view by default"}>
                {v.name} <small>{periodShort(v.period)}</small>{draft.defaultView === v.name ? " · default" : ""}
              </button>
              <button type="button" aria-label={`Delete view ${v.name}`} onClick={() => setDraft((d) => ({ ...d, views: d.views.filter((x) => x.name !== v.name), defaultView: d.defaultView === v.name ? null : d.defaultView }))}>
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="new">
          <input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Name, e.g. Monday review" maxLength={40} aria-label="New view name" />
          <button type="button" className="bi-btn" disabled={!viewName.trim()} onClick={saveView}>Save current as view</button>
        </div>
      </section>
      {sections.map((s) => (
        <section key={s.id} className="bi-cz">
          <h3>{s.title || (s.kind === "attention" ? "Needs attention" : "Section")}</h3>
          <ul>
            {orderOf(s).map((qid, i, list) => (
              <li key={qid} className={hidden.has(qid) ? "off" : ""}>
                <span className="name">{nameOf(qid)}</span>
                <button type="button" className="bi-btn bi-btn-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(s, i, -1)}><ArrowUp size={14} /></button>
                <button type="button" className="bi-btn bi-btn-icon" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(s, i, 1)}><ArrowDown size={14} /></button>
                <button type="button" className={`bi-btn ${hidden.has(qid) ? "" : "on"}`} onClick={() => toggle(qid)} aria-pressed={!hidden.has(qid)}>
                  {hidden.has(qid) ? <><EyeOff size={14} /> Hidden</> : <><Eye size={14} /> Shown</>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Shell>
  );
}
