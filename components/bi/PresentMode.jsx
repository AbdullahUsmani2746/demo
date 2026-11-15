"use client";
// components/bi/PresentMode.jsx — Present mode for meetings / a wall screen:
// full screen, dark, large figures, one section at a time, next section every
// 20 s (← → to move, Space to pause, Esc to leave). Uses the same canvas as
// the dashboard, so every figure is the same one people see on their screens.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import DashboardCanvas from "./DashboardCanvas";
import { periodTitle, parsePeriod, rangeText } from "@/lib/bi/periods";

const STEP_MS = 20000;

export default function PresentMode({ open, onClose, name, layout, results, period, compare, summary, dashboardId, events }) {
  const rootRef = useRef(null);
  const sections = (layout?.sections ?? []).filter((s) => s.items?.length);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = sections.length || 1;
  const go = useCallback((d) => setI((x) => (x + d + n) % n), [n]);

  useEffect(() => {
    if (!open) return;
    setI(0);
    rootRef.current?.requestFullscreen?.().catch(() => {});
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    const onFs = () => !document.fullscreenElement && onClose();
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [open, onClose, go]);

  useEffect(() => {
    if (!open || paused) return;
    const t = setInterval(() => go(1), STEP_MS);
    return () => clearInterval(t);
  }, [open, paused, go]);

  if (!open) return null;
  const s = sections[i];
  const range = parsePeriod(period);
  return (
    <div ref={rootRef} className="bi bi-present dark" role="dialog" aria-modal="true" aria-label={`Presenting ${name}`}>
      <header className="bi-present-head">
        <div className="min-w-0">
          <p>{name} · {s?.title || "Section"} · {i + 1} of {n}</p>
          <h1>{periodTitle(period)}{range ? ` — ${rangeText(range)}` : ""}</h1>
        </div>
        <div className="bi-present-ctrl">
          <button type="button" aria-label="Previous section" onClick={() => go(-1)}><ChevronLeft size={22} /></button>
          <button type="button" aria-label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)}>{paused ? <Play size={20} /> : <Pause size={20} />}</button>
          <button type="button" className="next" aria-label="Next section" onClick={() => go(1)}><ChevronRight size={22} /></button>
          <button type="button" aria-label="Leave present mode" onClick={onClose}><X size={20} /></button>
        </div>
      </header>
      {i === 0 && summary && <p className="bi-present-summary"><b>{summary.lead}</b> {summary.rest}</p>}
      <div className="bi-present-body">
        <DashboardCanvas
          layout={{ ...layout, sections: s ? [s] : [] }}
          results={results}
          period={period}
          compare={compare}
          dashboardId={dashboardId}
          events={events}
        />
      </div>
      <footer className="bi-present-foot">
        <span>{paused ? "Paused" : "Next section every 20 s"} · Esc to leave</span>
        <span className="dots">
          {sections.map((x, j) => <i key={x.id} className={j === i ? "on" : ""} />)}
        </span>
      </footer>
    </div>
  );
}
