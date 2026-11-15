"use client";
// components/permissions/MenuAccessTab.jsx — Admin → Permissions → Menu access.
// Take any menu away from a person or a whole role. A hidden menu (and every
// menu under it) leaves the sidebar and its page refuses to open — even for
// roles that show the whole menu. Super Admin is never blocked. Engine:
// lib/menu/blocks.js. Roles: the catalogue (Admin → Roles).
// Layout: role / person picker on the left (lg+), the menu tree on the right.
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, EyeOff, Eye, Loader2, Search, KeyRound, UserRound, ListTree, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useRoles } from "@/hooks/useRoles";


const CARD = "rounded-xl border border-border bg-background";
const CARD_HEAD = "border-b border-primary/15 bg-primary/5 px-4 py-3";
const LABEL = "text-[11px] font-bold uppercase tracking-wider text-primary";

function Node({ node, depth, state, onToggle, open, setOpen, term, busy }) {
  const kids = node.children || [];
  const isOpen = term ? true : open.has(node.id);
  const s = state(node);
  return (
    <>
      <div
        className={`group flex items-center gap-2 border-b border-border/60 py-2 pr-3 text-sm transition hover:bg-primary/[0.03] ${s.hidden ? "bg-destructive/[0.04]" : ""}`}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        {kids.length ? (
          <button
            onClick={() => setOpen(node.id)}
            className="rounded p-0.5 text-primary/70 hover:bg-primary/10 hover:text-primary"
            aria-label={isOpen ? "Collapse" : "Expand"}
            aria-expanded={isOpen}
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <span className={`${depth === 0 ? "font-semibold" : "font-medium"} ${s.hidden ? "text-muted-foreground line-through" : ""}`}>{node.title}</span>
          {node.url && node.url !== "#" && (
            <span className="block truncate font-mono text-[11px] text-muted-foreground sm:ml-2 sm:inline">{node.url}</span>
          )}
          {/* phone: the status chip wraps under the title */}
          {s.badge && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold sm:hidden ${s.badgeCls}`}>{s.badge}</span>}
        </div>
        {s.badge && <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline ${s.badgeCls}`}>{s.badge}</span>}
        {s.toggle ? (
          <button
            onClick={() => onToggle(node, !s.own)}
            disabled={busy === node.id}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition disabled:opacity-50 ${
              s.own
                ? "border-destructive/40 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "border-border bg-background hover:border-destructive/50 hover:text-destructive"
            }`}
            title={s.own ? "Show again" : "Hide this menu (and everything under it)"}
          >
            {busy === node.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s.own ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {s.own ? "Hidden" : "Hide"}
          </button>
        ) : (
          <span className="inline-flex h-8 w-[78px] shrink-0 items-center justify-center text-muted-foreground"><Lock className="h-3.5 w-3.5" /></span>
        )}
      </div>
      {isOpen &&
        kids.map((k) => <Node key={k.id} node={k} depth={depth + 1} state={state} onToggle={onToggle} open={open} setOpen={setOpen} term={term} busy={busy} />)}
    </>
  );
}

export default function MenuAccessTab() {
  const [subject, setSubject] = useState({ type: "role", id: "EMPLOYEE" });
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const { roles: catalogue, roleName } = useRoles();
  // Roles that show the whole menu (Admin → Roles → Sidebar)
  const allMenuRoles = catalogue.filter((r) => r.is_active && r.nav_mode === "all").map((r) => r.code);
  const [q, setQ] = useState("");
  const [who, setWho] = useState(""); // picker search (UI only)
  const [open, setOpenSet] = useState(() => new Set());
  const [busy, setBusy] = useState(null);

  const load = async (s = subject) => {
    const params = s.type === "user" ? { userId: s.id } : { role: s.id };
    const { data: d } = await axios.get("/api/menu/blocks", { params });
    setData(d);
    setUsers(d.users || []);
    setRoles(d.roles || []);
  };
  useEffect(() => {
    load().catch((e) => toast.error(e.response?.data?.error || e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.type, subject.id]);

  const setOpen = (id) => setOpenSet((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  // parent of every node, to tell "hidden because a menu above is hidden"
  const parentOf = useMemo(() => {
    const m = new Map();
    const walk = (nodes, p) => nodes.forEach((n) => { m.set(n.id, p); walk(n.children || [], n.id); });
    walk(data?.tree || [], null);
    return m;
  }, [data]);

  const own = useMemo(() => new Set(data?.blocked || []), [data]);
  const role = useMemo(() => new Set(data?.viaRole || []), [data]);
  const given = useMemo(() => (data?.given ? new Set(data.given) : null), [data]);
  const subjRole = data?.subject?.role;

  const ancestorHidden = (id) => {
    let p = parentOf.get(id);
    while (p != null) {
      if (own.has(p) || role.has(p)) return true;
      p = parentOf.get(p);
    }
    return false;
  };

  const state = (n) => {
    if (data?.subject?.locked) return { toggle: false, badge: "Super Admin — never blocked", badgeCls: "bg-muted text-muted-foreground" };
    if (own.has(n.id)) return { toggle: true, own: true, hidden: true };
    if (role.has(n.id)) return { toggle: true, own: false, hidden: true, badge: `Hidden by role`, badgeCls: "bg-destructive/10 text-destructive" };
    if (ancestorHidden(n.id)) return { toggle: true, own: false, hidden: true, badge: "Hidden (menu above)", badgeCls: "bg-muted text-muted-foreground" };
    if (subject.type === "user") {
      const has = allMenuRoles.some((r) => (data?.subject?.roles || [subjRole]).includes(r)) || given?.has(n.id);
      return { toggle: true, own: false, badge: has ? "Has it" : null, badgeCls: "bg-[#edf2ee] text-[#2f5139]" };
    }
    return { toggle: true, own: false };
  };

  async function toggle(node, block) {
    setBusy(node.id);
    try {
      await axios.put("/api/menu/blocks", {
        menuId: node.id,
        ...(subject.type === "user" ? { userId: subject.id } : { role: subject.id }),
        blocked: block,
      });
      await load();
      toast.success(block ? `"${node.title}" hidden${node.children?.length ? " with everything under it" : ""}` : `"${node.title}" shown again`);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setBusy(null);
    }
  }

  // search: keep matching nodes and the path to them
  const term = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!data) return [];
    if (!term) return data.tree;
    const keep = (nodes) =>
      nodes.reduce((out, n) => {
        const kids = keep(n.children || []);
        if (n.title.toLowerCase().includes(term) || String(n.url || "").toLowerCase().includes(term) || kids.length) out.push({ ...n, children: kids });
        return out;
      }, []);
    return keep(data.tree);
  }, [data, term]);

  // picker lists, filtered by the picker's own search box
  const whoTerm = who.trim().toLowerCase();
  const pickRoles = roles.filter((r) => !whoTerm || `${r} ${roleName(r)}`.toLowerCase().includes(whoTerm));
  const pickPeople = users.filter((u) => !whoTerm || `${u.name} ${roleName(u.role)}`.toLowerCase().includes(whoTerm));
  const pickRow = (s, title, sub, Icon) => {
    const active = subject.type === s.type && subject.id === s.id;
    return (
      <button
        key={`${s.type}:${s.id}`}
        type="button"
        onClick={() => setSubject(s)}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left transition ${
          active ? "border-primary bg-primary/10" : "border-transparent hover:bg-primary/[0.04]"
        }`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${active ? "font-semibold text-primary" : ""}`}>{title}</span>
          {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex items-start gap-3 border-primary/15 bg-primary/5 p-4 text-sm`}>
        <ListTree className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-primary">Take any menu away from a person or a whole role</p>
          <p className="text-xs text-muted-foreground">
            A hidden menu — and every menu under it — leaves the sidebar and its page will not open, even for Accountant / Manager. It
            overrides the menus given on the employee. ADMIN is never blocked.
          </p>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── left: role / person ─────────────────────────────────── */}
        <aside className={`${CARD} overflow-hidden lg:sticky lg:top-4`}>
          <div className={CARD_HEAD}>
            <h3 className="text-[15px] font-semibold text-primary">Whose menus?</h3>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Find a role or person…" className="h-9 bg-background pl-9" />
            </div>
          </div>
          <div className="max-h-[22rem] overflow-y-auto lg:max-h-[calc(100vh-15rem)]">
            {pickRoles.length > 0 && (
              <>
                <div className={`${LABEL} bg-muted/40 px-3 py-1.5`}>Roles</div>
                {pickRoles.map((r) => pickRow({ type: "role", id: r }, roleName(r), "Everyone with this role", KeyRound))}
              </>
            )}
            {pickPeople.length > 0 && (
              <>
                <div className={`${LABEL} bg-muted/40 px-3 py-1.5`}>People</div>
                {pickPeople.map((u) => pickRow({ type: "user", id: u.id }, u.name, roleName(u.role), UserRound))}
              </>
            )}
            {pickRoles.length + pickPeople.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">{data ? "Nothing matches." : "Loading…"}</p>
            )}
          </div>
        </aside>

        {/* ── right: the menu tree ────────────────────────────────── */}
        <section className={`${CARD} min-w-0 overflow-hidden`}>
          <div className={`${CARD_HEAD} flex flex-wrap items-center gap-x-3 gap-y-2`}>
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold text-primary">
                Menus for {data?.subject?.name ?? "…"}
                {data?.subject?.type === "user" && <span className="ml-2 text-sm font-normal text-muted-foreground">({(data.subject.roles || [data.subject.role]).map(roleName).join(", ")})</span>}
              </h3>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{own.size} hidden here</span>
                {role.size > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{role.size} by role</span>}
              </div>
            </div>
            <div className="relative w-full sm:ml-auto sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menus…" className="h-9 bg-background pl-9" />
            </div>
          </div>
          {!data ? (
            <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No menus match.</div>
          ) : (
            filtered.map((n) => <Node key={n.id} node={n} depth={0} state={state} onToggle={toggle} open={open} setOpen={setOpen} term={term} busy={busy} />)
          )}
        </section>
      </div>
    </div>
  );
}
