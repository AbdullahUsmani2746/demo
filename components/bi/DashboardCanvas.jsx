"use client";
// components/bi/DashboardCanvas.jsx — draws a dashboard layout. Used by the
// viewer and the designer preview, so both look exactly the same.
//
// A section's kind (BI Designer → Layout) decides how its widgets show:
//   hero       big KPI cards (up to 4 a row) — figure, vs previous, vs last
//              year, trend line, target bullet bar
//   compact    a row of small KPI cards
//   attention  "Needs attention" tiles, most urgent first (their colour rules),
//              each with Seen
//   (none)     the grid of widgets, width 1–4 of 4 columns
// Every section is an anchor (#sec-<id>) for the section menu.
import { useEffect, useMemo, useState } from "react";
import Widget from "./Widget";
import { AlertTile, HeroCard, MiniCard, alertSeverity, alertValue } from "./Cards";
import { formatFull } from "./format";

export const sectionAnchor = (s) => `sec-${s.id}`;

const SEEN_KEY = (dashId) => `bi-seen:${dashId ?? "x"}`;
function readSeen(dashId) {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY(dashId)) || "{}") || {};
  } catch {
    return {};
  }
}

function SectionHead({ title, extra }) {
  if (!title && !extra) return null;
  return (
    <div className="bi-section-head">
      {title && <h2>{title}</h2>}
      {extra}
    </div>
  );
}

function Skeletons({ kind, count }) {
  const n = Math.max(count, 1);
  if (kind === "hero") return <div className="bi-hero-grid">{Array.from({ length: n }, (_, i) => <div key={i} className="bi-skel" style={{ height: 210 }} />)}</div>;
  if (kind === "compact") return <div className="bi-mini-grid">{Array.from({ length: n }, (_, i) => <div key={i} className="bi-skel" style={{ height: 88 }} />)}</div>;
  if (kind === "attention") return <div className="bi-alert-grid">{Array.from({ length: n }, (_, i) => <div key={i} className="bi-skel" style={{ height: 66 }} />)}</div>;
  return null;
}

export default function DashboardCanvas({ layout, results = {}, period, loading, onDrill, onFollowup, onInfo, onWhy, onApprovals, compare = true, dashboardId, updatedAt, hidden, order, events, only }) {
  // "Seen" on attention tiles: per browser, per dashboard; a tile comes back
  // by itself when its figure changes.
  const [seen, setSeen] = useState({});
  useEffect(() => setSeen(readSeen(dashboardId)), [dashboardId]);
  const [showSeen, setShowSeen] = useState(false);
  const toggleSeen = (qid, stamp) => {
    setSeen((cur) => {
      const next = { ...cur };
      if (next[qid] === stamp) delete next[qid];
      else next[qid] = stamp;
      try {
        localStorage.setItem(SEEN_KEY(dashboardId), JSON.stringify(next));
      } catch {
        /* storage blocked — Seen lasts until reload */
      }
      return next;
    });
  };

  const sections = useMemo(() => layout?.sections ?? [], [layout]);
  if (!layout) {
    return loading ? (
      <div className="bi-cq">
        <Skeletons kind="hero" count={4} />
        <div className="bi-grid" style={{ marginTop: 16 }}>
          <div className="bi-skel bi-w2" style={{ height: 300 }} />
          <div className="bi-skel bi-w2" style={{ height: 300 }} />
        </div>
      </div>
    ) : null;
  }
  if (sections.length === 0) {
    return (
      <div className="bi-card bi-empty-state">
        <div style={{ fontWeight: 600, fontSize: 14 }}>This dashboard has no widgets yet</div>
        <div className="bi-sub" style={{ marginTop: 4 }}>Add questions to it in the BI Designer → Dashboards.</div>
      </div>
    );
  }

  const drillOf = (it, r) => (onDrill && r?.result ? (point) => onDrill(it.questionId, point, r) : undefined);
  const visible = (it) => !hidden?.has?.(it.questionId);
  // The person's own order of a section's cards (Customize), else the layout's.
  const ordered = (s) => {
    const saved = order?.[s.id];
    if (!saved?.length) return s.items ?? [];
    const pos = new Map(saved.map((q, i) => [q, i]));
    return [...(s.items ?? [])].sort((a, b) => (pos.get(a.questionId) ?? 999) - (pos.get(b.questionId) ?? 999));
  };

  return (
    <div className="bi-cq">
      {sections.filter((s) => !only || only(s)).map((s) => {
        const items = ordered(s).filter(visible);
        if (!items.length) return null;
        const pending = loading && items.every((it) => !results[it.questionId]);

        if (s.kind === "hero" || s.kind === "compact") {
          return (
            <section className="bi-section" id={sectionAnchor(s)} key={s.id}>
              <SectionHead title={s.title} />
              {pending ? (
                <Skeletons kind={s.kind} count={items.length} />
              ) : (
                <div className={s.kind === "hero" ? "bi-hero-grid" : "bi-mini-grid"}>
                  {items.map((it) => {
                    const r = results[it.questionId];
                    if (!r?.result?.kpi) {
                      return (
                        <div key={it.id} className="bi-w1">
                          <Widget name={r?.name ?? "…"} config={r?.config} result={r?.result} error={r?.error} period={period} loading={loading && !r} onDrill={drillOf(it, r)} />
                        </div>
                      );
                    }
                    const props = {
                      name: r.name,
                      result: r.result,
                      options: r.config?.visual?.options || {},
                      compare,
                      onOpen: drillOf(it, r) ? () => drillOf(it, r)({}) : undefined,
                    };
                    return s.kind === "hero" ? (
                      <HeroCard key={it.id} {...props} description={r.description} datasetLabel={r.datasetLabel} period={period} updatedAt={updatedAt}
                        onInfo={onInfo ? () => onInfo({ ...r, questionId: it.questionId }) : undefined}
                        onWhy={onWhy && !r.result.meta?.pointInTime ? () => onWhy({ ...r, questionId: it.questionId }) : undefined} />
                    ) : (
                      <MiniCard key={it.id} {...props} />
                    );
                  })}
                </div>
              )}
            </section>
          );
        }

        if (s.kind === "attention") {
          const tiles = items
            .map((it) => {
              const r = results[it.questionId];
              const options = r?.config?.visual?.options || {};
              const f = alertValue(r?.result);
              const stamp = f ? formatFull(f.value, f.format) : "";
              return { it, r, options, stamp, severity: alertSeverity(r?.result, options), isSeen: seen[it.questionId] === stamp };
            })
            .filter((t) => t.r?.result)
            .sort((a, b) => b.severity - a.severity);
          const seenCount = tiles.filter((t) => t.isSeen).length;
          const shown = showSeen ? tiles : tiles.filter((t) => !t.isSeen);
          return (
            <section className="bi-section" id={sectionAnchor(s)} key={s.id}>
              <SectionHead
                title={<>{s.title || "Needs attention"} <span className="bi-section-note">· most urgent first</span></>}
                extra={seenCount > 0 && (
                  <button type="button" className="bi-link" onClick={() => setShowSeen((v) => !v)}>
                    {showSeen ? "Hide seen" : `Show seen (${seenCount})`}
                  </button>
                )}
              />
              {pending ? (
                <Skeletons kind="attention" count={items.length} />
              ) : shown.length ? (
                <div className="bi-alert-grid">
                  {shown.map((t) => (
                    <AlertTile
                      key={t.it.id}
                      name={t.r.name}
                      result={t.r.result}
                      options={t.options}
                      seen={t.isSeen}
                      actionLabel={t.options.opens === "approvals" && onApprovals ? "Review" : undefined}
                      onSeen={t.options.opens === "approvals" && onApprovals ? onApprovals : () => toggleSeen(t.it.questionId, t.stamp)}
                      onOpen={drillOf(t.it, t.r) ? () => drillOf(t.it, t.r)({}) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="bi-allclear">Nothing needs attention — all clear.</div>
              )}
            </section>
          );
        }

        return (
          <section className="bi-section" id={sectionAnchor(s)} key={s.id}>
            <SectionHead title={s.title} />
            <div className="bi-grid">
              {items.map((it) => {
                const r = results[it.questionId];
                return (
                  <div key={it.id} className={`bi-w${it.width || 1}`}>
                    <Widget
                      name={r?.name ?? "…"}
                      description={r?.description}
                      datasetLabel={r?.datasetLabel}
                      config={r?.config}
                      result={r?.result}
                      error={!loading && !r ? "This question no longer exists." : r?.error}
                      period={period}
                      compare={compare}
                      updatedAt={updatedAt}
                      loading={loading && !r?.result && !r?.error}
                      onDrill={drillOf(it, r)}
                      followup={r?.followup}
                      onFollowup={onFollowup}
                      events={events}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
