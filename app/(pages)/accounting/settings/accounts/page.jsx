"use client";
// Finance → Account Settings: EVERY account the system posts to automatically,
// in one place — item posting defaults, sales tax, freight, costing journals,
// POS, party / cash / bank / LC groups, voucher rules — and each item
// category's own accounts. Each setting shows where it is used, on which side
// (Dr / Cr) and against which contra account.
// Definitions: lib/accounts/accountSettingDefs.js · values: account_settings +
// ItemCategory (GET / PUT /api/settings/accounts).
//
// Layout: sections down the left (a dot marks one that needs attention), the
// settings on the right; a save bar stays at the bottom while anything is
// changed (Ctrl+S). Item categories: a table, one card per category on a phone.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import Select from "react-select";
import { toast } from "sonner";
import {
  Landmark, Receipt, Truck, Calculator, Store, Users, Ship, ShieldBan, Package,
  Save, RotateCcw, AlertTriangle, CheckCircle2, Loader2, Search, Tags, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectStyles as baseSelectStyles } from "@/components/shared/EntityFormPanel";

const SECTION_ICONS = {
  ITEMS: Package, TAXES: Receipt, FREIGHT: Truck, COSTING: Calculator, POS: Store,
  PARTIES: Users, IMPORTS: Ship, VOUCHERS: ShieldBan,
};

// Draft value of one setting: number|null for ACCOUNT, number[] for GROUP / LIST.
const valueOf = (s) => (s.kind === "GROUP" ? [...(s.macnos || [])] : s.kind === "LIST" ? [...(s.acnos || [])] : s.acno ?? null);
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const catValue = (c, cols) => Object.fromEntries(cols.map((col) => [col.key, c[col.key]?.acno ?? null]));

const formatWhen = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const SidePill = ({ side }) => (
  <span
    className={`inline-flex w-8 justify-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
      side === "Dr" ? "bg-primary/10 text-primary" : "bg-[#edf2ee] text-[#2f5139]"
    }`}
  >
    {side}
  </span>
);

// The shared maroon react-select look, a little smaller, with maroon chips.
const selectStyles = {
  ...baseSelectStyles(false),
  control: (b, st) => ({ ...baseSelectStyles(false).control(b, st), minHeight: 38, fontSize: 13 }),
  option: (b, st) => ({ ...baseSelectStyles(false).option(b, st), fontSize: 13 }),
  multiValue: (b) => ({ ...b, fontSize: 12, backgroundColor: "hsl(var(--primary) / 0.08)", borderRadius: 5 }),
  multiValueLabel: (b) => ({ ...b, color: "hsl(var(--primary))", fontWeight: 600 }),
  multiValueRemove: (b) => ({ ...b, color: "hsl(var(--primary))", ":hover": { backgroundColor: "hsl(var(--primary) / 0.15)" } }),
  menuPortal: (b) => ({ ...b, zIndex: 60 }),
};

const sectionDomId = (id) => `acc-section-${id}`;
const settingDomId = (key) => `acc-setting-${key}`;

export default function AccountSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState([]);
  const [settings, setSettings] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryColumns, setCategoryColumns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [mains, setMains] = useState([]);
  const [draft, setDraft] = useState({});
  const [catDraft, setCatDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [catFilter, setCatFilter] = useState("");
  const [tab, setTab] = useState("settings");
  const [portal, setPortal] = useState(null);

  useEffect(() => setPortal(typeof document !== "undefined" ? document.body : null), []);

  const applyPayload = (data) => {
    setSections(data.sections || []);
    setSettings(data.settings || []);
    setCategories(data.categories || []);
    setCategoryColumns(data.categoryColumns || []);
    setDraft(Object.fromEntries((data.settings || []).map((s) => [s.key, valueOf(s)])));
    setCatDraft(Object.fromEntries((data.categories || []).map((c) => [c.id, catValue(c, data.categoryColumns || [])])));
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cfg, acc, mac] = await Promise.all([
          axios.get("/api/settings/accounts"),
          axios.get("/api/accounts/acno"),
          axios.get("/api/accounts/macno"),
        ]);
        if (!alive) return;
        applyPayload(cfg.data);
        setAccounts(acc.data?.data || []);
        setMains(Array.isArray(mac.data) ? mac.data : mac.data?.data || []);
      } catch (e) {
        toast.error(e?.response?.data?.error || "Failed to load account settings");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const mainName = useMemo(() => Object.fromEntries(mains.map((m) => [m.macno, m.macname])), [mains]);
  const { accountOptions, accountOption } = useMemo(() => {
    const opt = (a) => ({ value: a.acno, label: `${a.acno} · ${a.acname}`, group: mainName[a.macno] || "" });
    const sorted = [...accounts].sort((a, b) => a.acno - b.acno).map(opt);
    return { accountOptions: sorted, accountOption: Object.fromEntries(sorted.map((o) => [o.value, o])) };
  }, [accounts, mainName]);
  const mainOptions = useMemo(
    () => [...mains].sort((a, b) => a.macno - b.macno).map((m) => ({ value: m.macno, label: `${m.macno} · ${m.macname}` })),
    [mains],
  );
  const mainOption = useMemo(() => Object.fromEntries(mainOptions.map((o) => [o.value, o])), [mainOptions]);

  const filterAccount = (o, input) => {
    const q = input.trim().toLowerCase();
    return !q || o.label.toLowerCase().includes(q) || (o.data?.group || "").toLowerCase().includes(q);
  };
  const formatAccount = (o, { context }) => (
    <div className="min-w-0">
      <div className="truncate">{o.label}</div>
      {context === "menu" && o.group && <div className="truncate text-[11px] opacity-60">{o.group}</div>}
    </div>
  );
  // An id saved earlier that is no longer in the chart still shows, flagged.
  const optFor = (acno) => accountOption[acno] || { value: acno, label: `${acno} · (account not found)` };

  const dirtyKeys = settings.filter((s) => !sameValue(draft[s.key], valueOf(s))).map((s) => s.key);
  const dirtyCats = categories.filter((c) => !sameValue(catDraft[c.id], catValue(c, categoryColumns))).map((c) => c.id);
  const dirtyCount = dirtyKeys.length + dirtyCats.length;

  const isUnsetRequired = (s) => s.required && (s.kind === "ACCOUNT" ? draft[s.key] == null : !(draft[s.key] || []).length);
  const isBroken = (s) => s.account?.missing || (s.accounts || []).some((a) => a.missing);
  const unsetRequired = settings.filter(isUnsetRequired);
  const brokenAccounts = settings.filter(isBroken);
  const needsAttention = (s) => isUnsetRequired(s) || isBroken(s) || !!errors[s.key];

  const save = async () => {
    if (!dirtyCount) return;
    setSaving(true);
    setErrors({});
    try {
      const body = {
        settings: dirtyKeys.map((key) => {
          const s = settings.find((x) => x.key === key);
          if (s.kind === "GROUP") return { key, macnos: draft[key] || [] };
          if (s.kind === "LIST") return { key, acnos: draft[key] || [] };
          return { key, acno: draft[key] ?? null };
        }),
        categories: dirtyCats.map((id) => ({ id, ...catDraft[id] })),
      };
      const { data } = await axios.put("/api/settings/accounts", body);
      applyPayload(data);
      toast.success(data.message || "Account settings saved");
    } catch (e) {
      setErrors(e?.response?.data?.errors || {});
      toast.error(e?.response?.data?.error || "Failed to save account settings");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(Object.fromEntries(settings.map((s) => [s.key, valueOf(s)])));
    setCatDraft(Object.fromEntries(categories.map((c) => [c.id, catValue(c, categoryColumns)])));
    setErrors({});
  };

  // Ctrl+S saves; leaving with unsaved changes asks first.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) save();
      }
    };
    const onLeave = (e) => {
      if (!dirtyCount) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  });

  const q = filter.trim().toLowerCase();
  const visible = (s) =>
    (!q || [s.label, s.help, ...(s.usedBy || [])].join(" ").toLowerCase().includes(q)) && (!onlyAttention || needsAttention(s));

  // The Account Settings default an empty category cell falls back to.
  const defaultLabel = (fallbackKey) => {
    if (!fallbackKey) return "Not set";
    const acno = draft[fallbackKey];
    return acno != null ? `Default: ${optFor(acno).label}` : "Default not set";
  };

  const goTo = (key) => {
    setTab("settings");
    setFilter("");
    setOnlyAttention(false);
    setTimeout(() => {
      const el = document.getElementById(settingDomId(key));
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.classList.add("ring-2", "ring-primary/40");
      setTimeout(() => el?.classList.remove("ring-2", "ring-primary/40"), 1600);
    }, 50);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading account settings…
      </div>
    );
  }

  const sectionRows = sections.map((section) => ({
    section,
    all: settings.filter((s) => s.section === section.id),
    rows: settings.filter((s) => s.section === section.id && visible(s)),
  }));
  const shownCount = sectionRows.reduce((n, x) => n + x.rows.length, 0);
  const cq = catFilter.trim().toLowerCase();
  const shownCategories = cq ? categories.filter((c) => String(c.name || "").toLowerCase().includes(cq)) : categories;

  const renderCategorySelect = (c, col) => {
    const row = catDraft[c.id] || {};
    return (
      <Select
        isClearable
        aria-label={`${c.name} — ${col.label}`}
        placeholder={<span className="text-xs">{defaultLabel(col.fallbackKey)}</span>}
        options={accountOptions}
        value={row[col.key] != null ? optFor(row[col.key]) : null}
        onChange={(o) => setCatDraft((d) => ({ ...d, [c.id]: { ...d[c.id], [col.key]: o?.value ?? null } }))}
        filterOption={filterAccount}
        formatOptionLabel={formatAccount}
        menuPortalTarget={portal}
        styles={selectStyles}
      />
    );
  };

  return (
    <div className="min-h-screen bg-muted/40 pb-24">
      <div className="mx-auto max-w-[1400px] space-y-4 px-3 py-5 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <Landmark className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">
                <Link href="/accounting/settings" className="hover:text-primary hover:underline">Settings</Link> · Accounts
              </p>
              <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
                Account Settings
                <span className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-bold tabular-nums text-primary">
                  {settings.length} settings
                </span>
                {unsetRequired.length + brokenAccounts.length > 0 && (
                  <span className="inline-flex h-6 items-center rounded-full bg-destructive/10 px-2.5 text-xs font-bold tabular-nums text-destructive">
                    {unsetRequired.length + brokenAccounts.length} need attention
                  </span>
                )}
              </h1>
            </div>
          </div>
        </div>
        <p className="max-w-3xl text-[13px] text-muted-foreground">
          Every account the system posts to automatically. Item lines use their item category&apos;s account first, then the
          default here. A required account that is not set stops the document from saving, with a message pointing back to
          this screen.
        </p>

        {/* Problems — each one jumps to its setting */}
        {(unsetRequired.length > 0 || brokenAccounts.length > 0) && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 space-y-2">
                {unsetRequired.length > 0 && (
                  <div>
                    <p className="font-semibold text-destructive">Required but not set</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {unsetRequired.map((s) => (
                        <button key={s.key} type="button" onClick={() => goTo(s.key)} className="rounded-full bg-background px-2.5 py-0.5 text-xs font-medium text-destructive ring-1 ring-destructive/25 hover:bg-destructive/10">
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {brokenAccounts.length > 0 && (
                  <div>
                    <p className="font-semibold text-destructive">Pointing at an account that no longer exists</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {brokenAccounts.map((s) => (
                        <button key={s.key} type="button" onClick={() => goTo(s.key)} className="rounded-full bg-background px-2.5 py-0.5 text-xs font-medium text-destructive ring-1 ring-destructive/25 hover:bg-destructive/10">
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tabs + tools */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border border-border bg-background p-1" role="tablist">
            {[["settings", "Posting accounts & groups", Landmark, settings.length], ["categories", "Item category accounts", Tags, categories.length]].map(([id, label, Icon, n]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                  tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{id === "settings" ? "Posting" : "Categories"}</span>
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === id ? "bg-white/20" : "bg-muted"}`}>{n}</span>
              </button>
            ))}
          </div>
          {tab === "settings" ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <label className="flex h-10 min-w-0 flex-1 basis-[220px] items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:w-80 sm:flex-none">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setFilter("")}
                  placeholder="Search settings or documents…"
                  aria-label="Search settings"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
                {filter && (
                  <button type="button" onClick={() => setFilter("")} aria-label="Clear search" className="hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </label>
              <button
                type="button"
                aria-pressed={onlyAttention}
                onClick={() => setOnlyAttention((v) => !v)}
                className={`h-10 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                  onlyAttention ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary hover:text-primary"
                }`}
              >
                Needs attention
              </button>
            </div>
          ) : (
            <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:w-72">
              <Search className="h-4 w-4 flex-shrink-0" />
              <input
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                placeholder="Find a category…"
                aria-label="Find a category"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
            </label>
          )}
        </div>

        {tab === "settings" && (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
            {/* Section list */}
            <nav aria-label="Sections" className="hidden rounded-xl border border-border bg-background p-1.5 lg:sticky lg:top-[calc(var(--header-height)+16px)] lg:block">
              {sectionRows.map(({ section, all, rows }) => {
                const Icon = SECTION_ICONS[section.id] || Landmark;
                const bad = all.some(needsAttention);
                const changed = all.some((s) => dirtyKeys.includes(s.key));
                return (
                  <button
                    key={section.id}
                    type="button"
                    disabled={!rows.length}
                    onClick={() => document.getElementById(sectionDomId(section.id))?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-primary/[0.06] hover:text-primary disabled:opacity-40"
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-primary/70" />
                    <span className="min-w-0 flex-1 truncate font-medium">{section.title}</span>
                    {bad && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-destructive" title="Needs attention" />}
                    {changed && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" title="Changed" />}
                    <span className="text-[11px] tabular-nums text-muted-foreground">{all.length}</span>
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0 space-y-4">
              {shownCount === 0 && (
                <div className="rounded-xl border border-dashed border-border bg-background px-6 py-12 text-center text-sm text-muted-foreground">
                  {onlyAttention ? "Nothing needs attention — every required account is set." : "No setting matches your search."}
                </div>
              )}
              {sectionRows.map(({ section, rows }) => {
                if (!rows.length) return null;
                const Icon = SECTION_ICONS[section.id] || Landmark;
                return (
                  <section key={section.id} id={sectionDomId(section.id)} className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-background">
                    <div className="flex items-start gap-3 border-b border-primary/15 bg-primary/5 px-4 py-3">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h2 className="text-[15px] font-semibold text-primary">{section.title}</h2>
                        <p className="text-xs text-muted-foreground">{section.description}</p>
                      </div>
                    </div>
                    <div className="divide-y divide-border/70">
                      {rows.map((s) => {
                        const value = draft[s.key];
                        const isSet = s.kind === "ACCOUNT" ? value != null : (value || []).length > 0;
                        const dirty = dirtyKeys.includes(s.key);
                        return (
                          <div
                            key={s.key}
                            id={settingDomId(s.key)}
                            className={`grid scroll-mt-28 gap-3 px-4 py-3.5 transition-shadow md:grid-cols-[1fr_minmax(280px,420px)] ${dirty ? "bg-primary/[0.04]" : ""}`}
                          >
                            <div className="min-w-0 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-foreground">{s.label}</span>
                                {isSet ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#edf2ee] px-2 py-0.5 text-[11px] font-semibold text-[#2f5139]">
                                    <CheckCircle2 className="h-3 w-3" /> Set
                                  </span>
                                ) : s.required ? (
                                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">Required — not set</span>
                                ) : (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Optional</span>
                                )}
                                {s.kind !== "ACCOUNT" && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                    {s.kind === "GROUP" ? "Main accounts" : "Account list"}
                                  </span>
                                )}
                                {dirty && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Changed</span>}
                              </div>
                              <p className="text-xs text-muted-foreground">{s.help}</p>
                              {s.postings?.length > 0 && (
                                <div className="space-y-0.5">
                                  {s.postings.map((p, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs">
                                      <SidePill side={p.side} /> <span className="font-medium">{p.doc}</span>
                                      <span className="text-muted-foreground">against {p.contra}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {s.usedBy?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {s.usedBy.map((u) => (
                                    <span key={u} className="rounded-full border border-border px-2 py-0.5 text-[10.5px] text-muted-foreground">{u}</span>
                                  ))}
                                </div>
                              )}
                              {s.updated_by && (
                                <div className="text-[11px] text-muted-foreground">
                                  Last changed by {s.updated_by}
                                  {formatWhen(s.updated_at) ? ` · ${formatWhen(s.updated_at)}` : ""}
                                </div>
                              )}
                            </div>
                            <div className="space-y-1">
                              {s.kind === "ACCOUNT" && (
                                <Select
                                  isClearable
                                  aria-label={s.label}
                                  placeholder="Choose an account…"
                                  options={accountOptions}
                                  value={value != null ? optFor(value) : null}
                                  onChange={(o) => setDraft((d) => ({ ...d, [s.key]: o?.value ?? null }))}
                                  filterOption={filterAccount}
                                  formatOptionLabel={formatAccount}
                                  menuPortalTarget={portal}
                                  styles={selectStyles}
                                />
                              )}
                              {s.kind === "LIST" && (
                                <Select
                                  isMulti
                                  aria-label={s.label}
                                  placeholder="Choose accounts…"
                                  options={accountOptions}
                                  value={(value || []).map(optFor)}
                                  onChange={(list) => setDraft((d) => ({ ...d, [s.key]: (list || []).map((o) => o.value) }))}
                                  filterOption={filterAccount}
                                  formatOptionLabel={formatAccount}
                                  menuPortalTarget={portal}
                                  styles={selectStyles}
                                />
                              )}
                              {s.kind === "GROUP" && (
                                <Select
                                  isMulti
                                  aria-label={s.label}
                                  placeholder="Choose main accounts…"
                                  options={mainOptions}
                                  value={(value || []).map((m) => mainOption[m] || { value: m, label: `${m} · (not found)` })}
                                  onChange={(list) => setDraft((d) => ({ ...d, [s.key]: (list || []).map((o) => o.value) }))}
                                  menuPortalTarget={portal}
                                  styles={selectStyles}
                                />
                              )}
                              {s.kind === "GROUP" && (value || []).length > 0 && (
                                <div className="text-[11px] text-muted-foreground">
                                  {accounts.filter((a) => (value || []).includes(a.macno)).length} accounts in{" "}
                                  {(value || []).map((m) => mainName[m] || m).join(", ")}
                                </div>
                              )}
                              {errors[s.key] && <div className="text-xs font-medium text-destructive">{errors[s.key]}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {tab === "categories" && (
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            <div className="border-b border-primary/15 bg-primary/5 px-4 py-3">
              <h2 className="text-[15px] font-semibold text-primary">Item category accounts</h2>
              <p className="text-xs text-muted-foreground">
                Leave a cell empty to use the default from Posting accounts. A category account always wins over the default.
              </p>
            </div>

            {/* Computer: one table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1400px] text-sm">
                <thead>
                  <tr className="bg-primary text-left">
                    <th className="sticky left-0 z-10 bg-primary px-3 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">Item category</th>
                    {categoryColumns.map((col) => (
                      <th key={col.key} className="px-2 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground" title={col.help}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownCategories.map((c) => {
                    const dirty = dirtyCats.includes(c.id);
                    return (
                      <tr key={c.id} className={`border-b border-border/60 ${dirty ? "bg-primary/[0.04]" : "hover:bg-primary/[0.02]"}`}>
                        <td className={`sticky left-0 z-10 px-3 py-2 font-semibold bg-background`}>
                          <span className="flex items-center gap-2">
                            {c.name}
                            {dirty && <span className="h-2 w-2 rounded-full bg-primary" title="Changed" />}
                          </span>
                          {errors[`category:${c.id}`] && <div className="text-xs font-medium text-destructive">{errors[`category:${c.id}`]}</div>}
                        </td>
                        {categoryColumns.map((col) => (
                          <td key={col.key} className="min-w-[180px] px-2 py-1.5">
                            {renderCategorySelect(c, col)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Phone: one card per category */}
            <div className="divide-y divide-border md:hidden">
              {shownCategories.map((c) => {
                const dirty = dirtyCats.includes(c.id);
                return (
                  <div key={c.id} className={`space-y-3 p-3 ${dirty ? "bg-primary/[0.04]" : ""}`}>
                    <p className="flex items-center gap-2 font-semibold">
                      {c.name}
                      {dirty && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Changed</span>}
                    </p>
                    {errors[`category:${c.id}`] && <p className="text-xs font-medium text-destructive">{errors[`category:${c.id}`]}</p>}
                    {categoryColumns.map((col) => (
                      <div key={col.key}>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{col.label}</p>
                        {renderCategorySelect(c, col)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {shownCategories.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No category matches.</p>}
          </div>
        )}
      </div>

      {/* Save bar — while anything is changed */}
      {dirtyCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 shadow-[0_-6px_18px_rgba(20,20,30,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-6">
            <span className="text-sm">
              <b className="text-primary">{dirtyCount}</b> unsaved change{dirtyCount === 1 ? "" : "s"}
              <span className="hidden text-muted-foreground sm:inline"> · Ctrl+S to save</span>
            </span>
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 bg-background" onClick={reset} disabled={saving}>
                <RotateCcw className="mr-1.5 h-4 w-4" /> Reset
              </Button>
              <Button className="h-10" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                Save {dirtyCount}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
