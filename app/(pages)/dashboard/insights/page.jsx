"use client";
// /dashboard/insights — "My Dashboards": every BI dashboard assigned to the
// signed-in person (by them, their role or their department), landing page
// first. One request per dashboard + period returns every figure, each
// already limited to what this person may see.
//
// Layout (2026-11 redesign, design: artifact "CEO Dashboard Redesign"):
//   header      company logo, dashboard name, books, refresh, designer, full screen
//   tabs        the person's dashboards
//   toolbar     period bar (Today … 12 months + Pick dates) · Compare · filters
//   body        section menu (left on wide screens, chips on a phone) +
//               period line with freshness, one-line summary, the sections
// Keys: T today · Y yesterday · M this month · / search · P present.
// The period stays in the address. Step 2 / 3: Why did it change, ⓘ, approve
// in a side panel, Customize (pin / hide / order, saved views — per person),
// search, event flags, dark mode (this page, per browser), Present mode, PDF.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import axios from "axios";
import Link from "next/link";
import { RefreshCw, PencilRuler, LayoutDashboard, Maximize2, Minimize2, SlidersHorizontal, X, Search, Moon, Sun, Printer, Settings2, Presentation, CheckSquare } from "lucide-react";
import DashboardCanvas, { sectionAnchor } from "@/components/bi/DashboardCanvas";
import DrillModal from "@/components/bi/DrillModal";
import SearchSelect from "@/components/bi/SearchSelect";
import PeriodBar from "@/components/bi/PeriodBar";
import LogFollowupModal from "@/components/followups/LogFollowupModal";
import { describePoint } from "@/components/bi/drill";
import { useCompany } from "@/context/CompanyContext";
import { isValidPeriod, parsePeriod, periodTitle, rangeText } from "@/lib/bi/periods";
import { buildSummary } from "@/lib/bi/summary";
import { WhyPanel, InfoDialog, ApprovalsPanel, CustomizeDialog } from "@/components/bi/DashboardPanels";
import PresentMode from "@/components/bi/PresentMode";
import { useSession } from "next-auth/react";

// Filters on EVERY dashboard (Book, Item Category, Series) come from the
// server (lib/bi/dashFilters.js — BI designers switch them on / off with
// "Dashboard filters"). Each narrows only the figures whose data has it.
// Book: narrow everything to one book (BI "book" field — questions without
// customers / accounts are not affected).
const BOOKS = [
  { key: "", label: "All books" },
  { key: "On books", label: "On" },
  { key: "Off books", label: "Off" },
];
// Live dashboards: every minute while the tab is shown — the server keeps
// each figure for 1 minute (app/api/bi/my/[id]) — and at once when the person
// comes back to the tab. A hidden tab does not poll.
const AUTO_REFRESH_MS = 60 * 1000;
const STALE_MS = 5 * 60 * 1000; // "not refreshed for a while" after 5 missed minutes

/** ?period=…&f_customer=A&f_customer=B — one parameter per chosen value. */
function queryString(period, filters, refresh) {
  const p = new URLSearchParams({ period });
  for (const [field, vals] of Object.entries(filters)) for (const v of vals || []) p.append(`f_${field}`, v);
  if (refresh) p.set("refresh", "1");
  return p.toString();
}

function ago(iso, now) {
  if (!iso) return null;
  const min = Math.max(0, Math.round((now - new Date(iso)) / 60000));
  return min < 1 ? "just now" : min === 1 ? "1 min ago" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

const DARK_KEY = "bi-dark";
const EMPTY_PREFS = { hidden: [], order: {}, views: [], defaultView: null };

function InsightsPage() {
  const { data: session } = useSession();
  const search = useSearchParams();
  const router = useRouter();
  const { company } = useCompany();
  const rootRef = useRef(null);
  const [list, setList] = useState(null);
  const [canDesign, setCanDesign] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [period, setPeriod] = useState(null);
  const [compare, setCompare] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(new Date());
  // Dashboard-wide filters: { field: [values] } and their choices
  const [filters, setFilters] = useState({});
  const [choices, setChoices] = useState({});
  const [drill, setDrill] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [followupId, setFollowupId] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [find, setFind] = useState("");
  const findRef = useRef(null);
  const [prefs, setPrefs] = useState(EMPTY_PREFS);
  const [view, setView] = useState("");
  const [why, setWhy] = useState(null);
  const [info, setInfo] = useState(null);
  const [showApprovals, setShowApprovals] = useState(false);
  const [approvals, setApprovals] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [dark, setDark] = useState(false);
  // Built-in filters switched on, as last sent by the server
  const [builtins, setBuiltins] = useState([]);
  const [showSetup, setShowSetup] = useState(false);

  // Dark mode: this page only, remembered in this browser.
  useEffect(() => {
    try {
      setDark(localStorage.getItem(DARK_KEY) === "1");
    } catch {
      /* storage blocked */
    }
  }, []);
  const toggleDark = () =>
    setDark((d) => {
      try {
        localStorage.setItem(DARK_KEY, d ? "0" : "1");
      } catch {
        /* storage blocked */
      }
      return !d;
    });

  // Approvals waiting for this person (the header button).
  const loadApprovals = useCallback(() => {
    axios.get("/api/approvals/count").then(({ data: d }) => setApprovals(d)).catch(() => {});
  }, []);
  useEffect(() => { loadApprovals(); }, [loadApprovals]);

  // Which dashboards are mine
  useEffect(() => {
    axios
      .get("/api/bi/my")
      .then(({ data: d }) => {
        setList(d.data || []);
        setCanDesign(Boolean(d.canDesign));
        const wanted = Number(search.get("id"));
        const pick = d.data?.find((x) => x.id === wanted) ?? d.data?.[0];
        if (pick) {
          setActiveId(pick.id);
          const asked = search.get("period");
          setPeriod(asked && isValidPeriod(asked) ? asked : pick.default_period || "mtd");
        }
      })
      .catch((e) => setError(e.response?.data?.error || e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The person's own settings for this dashboard (Customize).
  useEffect(() => {
    if (!activeId) return;
    setPrefs(EMPTY_PREFS);
    setView("");
    axios
      .get(`/api/bi/my/${activeId}/prefs`)
      .then(({ data: d }) => {
        setPrefs({ ...EMPTY_PREFS, ...d });
        const def = d.defaultView && (d.views || []).find((v) => v.name === d.defaultView);
        if (def && !search.get("period")) applyView(def);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  function applyView(v) {
    setView(v.name);
    setPeriod(v.period);
    setCompare(v.compare !== false);
    setFilters(v.filters || {});
  }

  async function savePrefs(next) {
    const { data: d } = await axios.put(`/api/bi/my/${activeId}/prefs`, next);
    setPrefs({ ...EMPTY_PREFS, ...d });
  }

  // Keep the dashboard and period in the address (refresh / share keeps them).
  useEffect(() => {
    if (!activeId || !period) return;
    router.replace(`/dashboard/insights?id=${activeId}&period=${encodeURIComponent(period)}`, { scroll: false });
  }, [activeId, period, router]);

  const load = useCallback(
    // silent: the automatic refresh — figures change in place, no loading state.
    async (refresh = false, { silent = false } = {}) => {
      if (!activeId || !period) return;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const { data: d } = await axios.get(`/api/bi/my/${activeId}?${queryString(period, filters, refresh)}`);
        // A silent answer for a dashboard the person has since left is dropped.
        setData((prev) => (silent && prev?.dashboard?.id !== d?.dashboard?.id ? prev : d));
        if (silent) setError(null);
        if (Array.isArray(d.builtinFilters)) setBuiltins(d.builtinFilters);
      } catch (e) {
        if (!silent) setError(e.response?.data?.error || e.message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeId, period, filters],
  );

  // Multi-select filters: the dashboard's own first, then the built-in ones
  // switched on that it does not have itself. Choices loaded once per dashboard.
  const bookOn = builtins.some((f) => f.field === "book");
  const filterDefs = useMemo(() => {
    const own = data?.dashboard?.id === activeId ? data.dashboard.layout?.filters ?? [] : [];
    const ownFields = new Set(own.map((f) => f.field));
    const extra = builtins
      .filter((f) => f.kind === "multi" && !ownFields.has(f.field))
      .map((f) => ({ field: f.field, label: f.label, builtin: true }));
    return [...own, ...extra];
  }, [data, activeId, builtins]);
  useEffect(() => {
    filterDefs.forEach((f) => {
      const key = `${activeId}:${f.field}`;
      if (choices[key]) return;
      setChoices((c) => ({ ...c, [key]: [] }));
      axios
        .get(`/api/bi/my/${activeId}/values`, { params: { field: f.field } })
        .then(({ data: d }) => setChoices((c) => ({ ...c, [key]: d.values || [] })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filterDefs), activeId]);
  // A built-in filter stays hidden on a dashboard none of whose data has it
  const shownDefs = filterDefs.filter((f) => !f.builtin || (choices[`${activeId}:${f.field}`] || []).length > 0);

  // narrow: { field, value } — one name from "Why did it change?"
  async function openDrill(questionId, point, r, narrow) {
    const title = r?.name || "Records";
    const subtitle = [describePoint(r.result, point), periodTitle(period), rangeText(parsePeriod(period))].filter(Boolean).join(" · ");
    setDrill({ title, subtitle, loading: true });
    try {
      const { data: d } = await axios.post(`/api/bi/my/${activeId}/drill`, {
        questionId,
        period,
        point,
        filters: Object.entries(filters).filter(([, v]) => v?.length).map(([field, value]) => ({ field, value })),
        ...(narrow ? { narrow } : {}),
      });
      setDrill({ title, subtitle, data: d });
    } catch (e) {
      setDrill({ title, subtitle, error: e.response?.data?.error || e.message });
    }
  }

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const t = setInterval(() => visible() && load(false, { silent: true }), AUTO_REFRESH_MS);
    const c = setInterval(() => setNow(new Date()), 30000);
    const onShow = () => visible() && load(false, { silent: true });
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      clearInterval(c);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  // Keys: T / Y / M — not while typing in a box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || e.target?.isContentEditable) return;
      if (e.key === "/") {
        e.preventDefault();
        findRef.current?.focus();
        return;
      }
      if (e.key?.toLowerCase() === "p") {
        setPresenting(true);
        return;
      }
      const map = { t: "today", y: "yday", m: "mtd" };
      const p = map[e.key?.toLowerCase()];
      if (p) {
        setPeriod(p);
        setView("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Full screen (e.g. on a wall TV) — follows Esc too.
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.();
  };

  const active = useMemo(() => list?.find((d) => d.id === activeId), [list, activeId]);
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => k !== "book" && v?.length).length;
  const book = filters.book?.[0] ?? "";
  const layout = data?.dashboard?.id === activeId ? data.dashboard.layout : null;
  const results = data?.dashboard?.id === activeId ? data.results : {};
  const range = parsePeriod(period);

  // Hidden: the person's hidden cards, and while searching every widget whose
  // name does not match.
  const hidden = useMemo(() => {
    const out = new Set(prefs.hidden || []);
    const term = find.trim().toLowerCase();
    if (term && layout) {
      for (const s of layout.sections ?? []) {
        for (const it of s.items ?? []) {
          const r = results?.[it.questionId];
          const text = `${r?.name ?? ""} ${r?.description ?? ""} ${s.title ?? ""}`.toLowerCase();
          if (!text.includes(term)) out.add(it.questionId);
        }
      }
    }
    return out;
  }, [prefs.hidden, find, layout, results]);

  // Section menu: every titled section (the summary / headline first).
  const navSections = useMemo(() => (layout?.sections ?? []).filter((s) => s.title || s.kind), [layout]);
  useEffect(() => {
    if (!navSections.length || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveSection(top.target.id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    navSections.forEach((s) => {
      const el = document.getElementById(sectionAnchor(s));
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [navSections, data]);

  // The first headline card — "See what changed" under the summary.
  const firstHero = useMemo(() => {
    const it = (layout?.sections ?? []).find((s) => s.kind === "hero")?.items?.[0];
    const r = it && results?.[it.questionId];
    return r?.result?.kpi && !r.result.meta?.pointInTime ? { ...r, questionId: it.questionId } : null;
  }, [layout, results]);

  const summary = useMemo(
    () => (layout && !loading ? buildSummary(layout, results, period, { compare }) : null),
    [layout, results, period, compare, loading],
  );

  function choose(id) {
    const d = list?.find((x) => x.id === Number(id));
    if (!d || d.id === activeId) return;
    setActiveId(d.id);
    setPeriod(d.default_period || "mtd");
    // The book choice carries over; the dashboard's own filters do not
    setFilters((x) => (x.book?.length ? { book: x.book } : {}));
    setData(null);
  }

  const updated = ago(data?.generatedAt, now);
  const stale = data?.generatedAt && now - new Date(data.generatedAt) > STALE_MS;
  const sectionLabel = (s) => s.title || (s.kind === "attention" ? "Needs attention" : s.kind === "hero" ? "Headline" : "Section");

  return (
    <div ref={rootRef} className={`bi bi-page bi-v3 ${dark ? "dark" : ""}`}>
      {/* Printed / PDF page header (screen: hidden) */}
      <div className="bi-print-head" aria-hidden="true">
        {company?.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logo} alt="" />
        )}
        <div>
          <b>{company?.name ? `${company.name} — ` : ""}{active?.name}</b>
          <span>
            {periodTitle(period)}{range ? ` · ${rangeText(range)}` : ""}{compare && range ? ` · compared with ${rangeText(range.prev)} and last year` : ""}
            {Object.entries(filters).filter(([, v]) => v?.length).map(([k, v]) => ` · ${k}: ${v.join(", ")}`).join("")}
          </span>
        </div>
        <span className="who">Printed {new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}{session?.user?.name ? ` by ${session.user.name}` : ""}</span>
      </div>
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="bi-head">
        <div className="bi-wrap bi-head-row">
          <div className="bi-head-brand">
            {company?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo} alt="" className="bi-logo" />
            ) : (
              <span className="bi-logo bi-logo-mark"><LayoutDashboard size={20} /></span>
            )}
            <div className="min-w-0">
              <p className="bi-head-sub">{company?.name ? `${company.name} · ` : ""}My Dashboards</p>
              <h1 className="bi-head-title">{active?.name || "Dashboards"}</h1>
            </div>
          </div>
          <div className="bi-head-actions">
            {list && list.length > 8 && (
              <SearchSelect ariaLabel="Switch dashboard" placeholder="Switch dashboard…" width={220} isClearable={false}
                value={activeId} options={list.map((d) => ({ value: d.id, label: d.name }))} onChange={choose} />
            )}
            {bookOn && (
              <div className="bi-seg" role="tablist" aria-label="Books">
                {BOOKS.map((b) => (
                  <button key={b.key || "all"} role="tab" aria-selected={b.key === book} className={b.key === book ? "active" : ""}
                    onClick={() => setFilters((x) => ({ ...x, book: b.key ? [b.key] : [] }))}
                    title={b.key ? `Only ${b.key.toLowerCase()} customers / accounts and their documents` : "Both books"}>
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            <label className="bi-find">
              <Search size={15} aria-hidden="true" />
              <input ref={findRef} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search this dashboard…" aria-label="Search this dashboard" />
              {find ? (
                <button type="button" aria-label="Clear search" onClick={() => setFind("")}><X size={13} /></button>
              ) : (
                <kbd>/</kbd>
              )}
            </label>
            {approvals?.isApprover && (
              <button className={`bi-btn ${approvals.count ? "on" : ""}`} onClick={() => setShowApprovals(true)} title="Approve without leaving the dashboard">
                <CheckSquare size={15} /> <span className="hidden sm:inline">Approvals</span>
                {approvals.count > 0 && <span className="bi-count-badge">{approvals.count}</span>}
              </button>
            )}
            <button className="bi-btn bi-btn-icon" onClick={() => load(true)} title="Refresh now" aria-label="Refresh now">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            {canDesign && (
              <Link className="bi-btn bi-btn-icon" href="/accounting/bi-designer" title="Open the BI Designer" aria-label="Open the BI Designer">
                <PencilRuler size={15} />
              </Link>
            )}
            {canDesign && (
              <div className="relative">
                <button
                  className={`bi-btn bi-btn-icon ${showSetup ? "on" : ""}`}
                  onClick={() => setShowSetup((s) => !s)}
                  title="Dashboard filters — switch the filters every dashboard has on / off"
                  aria-label="Dashboard filters"
                >
                  <SlidersHorizontal size={15} />
                </button>
                {showSetup && <DashFilterSetup onClose={() => setShowSetup(false)} onSaved={() => load(true)} />}
              </div>
            )}
            <button className="bi-btn bi-btn-icon" onClick={toggleDark} title={dark ? "Light mode" : "Dark mode"} aria-label={dark ? "Light mode" : "Dark mode"}>
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button className="bi-btn bi-btn-icon" onClick={() => setCustomizing(true)} title="Customize — pin / hide cards, saved views" aria-label="Customize">
              <Settings2 size={15} />
            </button>
            <button className="bi-btn bi-btn-icon" onClick={() => window.print()} title="PDF / print — A4 landscape" aria-label="PDF or print">
              <Printer size={15} />
            </button>
            <button className="bi-btn bi-btn-icon" onClick={toggleFullscreen} title={fullscreen ? "Exit full screen" : "Full screen"} aria-label={fullscreen ? "Exit full screen" : "Full screen"}>
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button className="bi-btn bi-btn-primary" onClick={() => setPresenting(true)} title="Present — key P">
              <Presentation size={15} /> <span className="hidden sm:inline">Present</span>
            </button>
          </div>
        </div>
        {list && list.length > 1 && list.length <= 8 && (
          <nav className="bi-wrap bi-tabs" aria-label="Dashboards">
            {list.map((d) => (
              <button key={d.id} className={d.id === activeId ? "active" : ""} onClick={() => choose(d.id)}>{d.name}</button>
            ))}
          </nav>
        )}
      </header>

      {/* ── Toolbar: period, compare, filters ─────────────────── */}
      {active && period && (
        <div className="bi-toolbar">
          <div className="bi-wrap bi-toolbar-row">
            <PeriodBar value={period} onChange={(p) => { setPeriod(p); setView(""); }} />
            <label className="bi-check">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              Compare
            </label>
            {prefs.views?.length > 0 && (
              <label className="bi-check bi-view">
                View
                <select value={view} aria-label="Saved view" onChange={(e) => {
                  const v = prefs.views.find((x) => x.name === e.target.value);
                  if (v) applyView(v);
                  else setView("");
                }}>
                  <option value="">—</option>
                  {prefs.views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </label>
            )}
            {shownDefs.length > 0 && (
              <>
                <button className={`bi-btn md:hidden ${activeFilterCount ? "on" : ""}`} onClick={() => setShowFilters((s) => !s)}>
                  <SlidersHorizontal size={14} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
                </button>
                <div className={`${showFilters ? "flex" : "hidden"} bi-filter-row md:flex`}>
                  {shownDefs.map((f) => (
                    <label key={f.field} className="bi-filter-field">
                      <span className="bi-filter-label">{f.label}</span>
                      <SearchSelect multi width={200} placeholder={`All ${f.label.toLowerCase()}`} value={filters[f.field] || []}
                        options={choices[`${activeId}:${f.field}`] || []} onChange={(vals) => setFilters((x) => ({ ...x, [f.field]: vals }))} />
                    </label>
                  ))}
                  {activeFilterCount > 0 && (
                    <button className="bi-btn" onClick={() => setFilters((x) => (x.book?.length ? { book: x.book } : {}))} title="Clear all filters">
                      <X size={14} /> Clear
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Body: section menu + content ──────────────────────── */}
      <div className="bi-wrap bi-body">
        {navSections.length > 1 && (
          <nav className="bi-secnav" aria-label="Sections">
            <span className="bi-secnav-title">On this page</span>
            {navSections.map((s) => (
              <a key={s.id} href={`#${sectionAnchor(s)}`} className={activeSection === sectionAnchor(s) ? "active" : ""}>
                {sectionLabel(s)}
              </a>
            ))}
            <div className="bi-keys">
              <b>Keys</b>
              <span><kbd>T</kbd> Today · <kbd>Y</kbd> Yesterday</span>
              <span><kbd>M</kbd> This month</span>
            </div>
          </nav>
        )}

        <main className="bi-content">
          {active && period && (
            <div className="bi-periodline">
              <p>
                <b>{periodTitle(period)}</b>
                {range && <span> · {rangeText(range)}</span>}
                {compare && range && <span> · vs {rangeText(range.prev, { year: false })} and last year</span>}
              </p>
              {updated && (
                <p className={`bi-fresh ${stale ? "stale" : ""}`} title={stale ? "These figures have not refreshed for a while" : "Live — refreshes every minute, and when you come back to this tab"}>
                  <span className="dot" aria-hidden="true" />Updated {updated}
                </p>
              )}
            </div>
          )}

          {summary && (
            <div className="bi-summary">
              <div>
                <p><b>{summary.lead}</b> {summary.rest}</p>
                {firstHero && (
                  <button type="button" className="bi-link" onClick={() => setWhy(firstHero)}>See what changed</button>
                )}
              </div>
            </div>
          )}

          {error && <div className="bi-error" style={{ marginBottom: 18 }}>{error}</div>}
          {!list && !error && <DashboardCanvas layout={null} loading />}
          {list && list.length === 0 && (
            <div className="bi-card bi-empty-state">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><LayoutDashboard size={22} /></span>
              <h2 className="mt-3 text-base font-semibold">No dashboard assigned to you yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {canDesign
                  ? "Build one in the BI Designer and assign it to a department, role or person."
                  : "Ask an administrator to assign a dashboard to you or your department."}
              </p>
              {canDesign && (
                <Link className="bi-btn bi-btn-primary mx-auto mt-4" href="/accounting/bi-designer">
                  <PencilRuler size={14} /> Open BI Designer
                </Link>
              )}
            </div>
          )}
          {active && (
            <DashboardCanvas
              layout={layout}
              results={results}
              period={period}
              compare={compare}
              dashboardId={activeId}
              updatedAt={updated}
              loading={loading || data?.dashboard?.id !== activeId}
              onDrill={openDrill}
              onFollowup={setFollowupId}
              onWhy={setWhy}
              onInfo={setInfo}
              onApprovals={approvals?.isApprover ? () => setShowApprovals(true) : undefined}
              hidden={hidden}
              order={prefs.order}
              events={data?.events}
            />
          )}
          {find && layout && hidden.size >= (layout.sections ?? []).reduce((n, x) => n + (x.items?.length || 0), 0) && (
            <div className="bi-allclear">Nothing on this dashboard matches “{find}”.</div>
          )}
          <footer className="bi-footer">
            Live ERP figures, limited to what you are allowed to see. Click any figure, bar or row for the records behind it.
          </footer>
        </main>
      </div>

      <DrillModal
        open={Boolean(drill)}
        title={drill?.title}
        subtitle={drill?.subtitle}
        data={drill?.data}
        loading={drill?.loading}
        error={drill?.error}
        onClose={() => setDrill(null)}
      />

      <WhyPanel
        open={Boolean(why)}
        onClose={() => setWhy(null)}
        dashboardId={activeId}
        item={why}
        period={period}
        filters={filters}
        onDrillValue={(field, value) => {
          const q = why;
          setWhy(null);
          openDrill(q.questionId, {}, { ...q, name: `${q.name} — ${value}` }, { field, value });
        }}
      />
      <InfoDialog open={Boolean(info)} onClose={() => setInfo(null)} item={info} period={period} filters={filters} updatedAt={updated} />
      <ApprovalsPanel open={showApprovals} onClose={() => setShowApprovals(false)} onChanged={() => { loadApprovals(); load(true); }} />
      <CustomizeDialog
        open={customizing}
        onClose={() => setCustomizing(false)}
        layout={layout}
        results={results}
        prefs={prefs}
        onSave={savePrefs}
        current={{ period, compare, filters }}
      />
      <PresentMode
        open={presenting}
        onClose={() => setPresenting(false)}
        name={active?.name}
        layout={layout}
        results={results}
        period={period}
        compare={compare}
        summary={summary}
        dashboardId={activeId}
        events={data?.events}
      />

      {followupId && <LogFollowupModal id={followupId} onClose={() => setFollowupId(null)} onSaved={() => load(true)} />}
    </div>
  );
}

/**
 * BI designers: switch the built-in dashboard filters on / off for every
 * dashboard and everybody (/api/bi/dash-filters, lib/bi/dashFilters.js).
 */
function DashFilterSetup({ onClose, onSaved }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    axios
      .get("/api/bi/dash-filters")
      .then(({ data: d }) => setRows(d.filters || []))
      .catch((e) => setErr(e.response?.data?.error || e.message));
  }, []);
  async function flip(field, enabled) {
    setBusy(field);
    setErr(null);
    try {
      const { data: d } = await axios.post("/api/bi/dash-filters", { [field]: enabled });
      setRows(d.filters || []);
      onSaved?.();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="bi-card fixed inset-x-4 top-32 z-30 p-3 text-left shadow-lg md:absolute md:inset-x-auto md:right-0 md:top-auto md:mt-2 md:w-72" role="dialog" aria-label="Dashboard filters">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Dashboard filters</span>
        <button className="bi-btn bi-btn-icon" onClick={onClose} title="Close" aria-label="Close"><X size={13} /></button>
      </div>
      <p className="mb-2 text-[12px] text-muted-foreground">
        On every dashboard, for everyone. A filter shows only where the dashboard&apos;s data has it.
      </p>
      {err && <div className="bi-error mb-2">{err}</div>}
      {!rows ? (
        <div className="text-[12px] text-muted-foreground">Loading…</div>
      ) : (
        rows.map((f) => (
          <label key={f.field} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50">
            <input type="checkbox" className="mt-0.5" checked={f.enabled} disabled={busy === f.field} onChange={(e) => flip(f.field, e.target.checked)} />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{f.label}</span>
              {f.description && <span className="block text-[11px] text-muted-foreground">{f.description}</span>}
            </span>
          </label>
        ))
      )}
    </div>
  );
}

// useSearchParams needs a Suspense boundary in a Next 15 build.
export default function InsightsRoute() {
  return (
    <Suspense fallback={<div className="bi bi-page" />}>
      <InsightsPage />
    </Suspense>
  );
}
