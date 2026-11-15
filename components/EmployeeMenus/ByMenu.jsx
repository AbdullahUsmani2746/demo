"use client";
// components/EmployeeMenus/ByMenu.jsx — pick a menu, tick who has it.
// Ticks are direct employee_menu rows on that menu. Someone who gets it through
// a row on a menu above it (buildMenu adds every active descendant) is shown
// ticked and locked "via …" — change that on the By employee view.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Select from "react-select";
import { toast } from "sonner";
import { ListTree, Lock, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { Chip, CODE_CHIP, LabEmpty } from "@/components/Material/shared/LabUI";
import { notifyMenuTreeChanged } from "@/hooks/useMenuTree";
import { diffIds, path } from "./menuTree";
import { ALL_DEPTS, matchEmployee } from "./EmployeePicker";
import MenuChecklist from "./MenuChecklist";
import { CARD, CARD_HEAD, ListSkeleton, SaveBar, TriCheck, isSaveKey } from "./shared";
import { cn } from "@/lib/utils";

const errText = (e) => e?.response?.data?.error || e?.message || "Something went wrong";
const SHOW = [
  ["all", "All"],
  ["has", "Has it"],
  ["not", "Doesn't"],
];

export default function ByMenu({ tree, employees, loading, meta, depts, guard, onDirty, onCounts }) {
  const canEdit = !!meta?.canEdit;
  const [menuId, setMenuId] = useState(null);
  const [base, setBase] = useState(null);
  const [draft, setDraft] = useState(null);
  const [inherited, setInherited] = useState(() => new Map());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [term, setTerm] = useState("");
  const [dept, setDept] = useState(ALL_DEPTS);
  const [show, setShow] = useState("all");
  const reqRef = useRef(0);

  const menu = menuId != null ? tree?.byId.get(menuId) : null;
  const diff = useMemo(() => (base && draft ? diffIds([...base], [...draft]) : { added: [], removed: [] }), [base, draft]);
  const changes = diff.added.length + diff.removed.length;
  useEffect(() => onDirty?.(changes > 0), [changes, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);

  useEffect(() => {
    if (menuId == null) return;
    const n = ++reqRef.current;
    setBusy(true);
    setBase(null);
    setDraft(null);
    axios
      .get("/api/employee-menus", { params: { menuId } })
      .then(({ data }) => {
        if (n !== reqRef.current) return;
        const s = new Set(data.employeeIds || []);
        setBase(s);
        setDraft(s);
        setInherited(new Map((data.inherited || []).map((r) => [r.employeeId, r.viaMenuId])));
      })
      .catch((e) => n === reqRef.current && toast.error(errText(e)))
      .finally(() => n === reqRef.current && setBusy(false));
  }, [menuId]);

  const pickMenu = (id) => {
    if (id === menuId) return;
    guard(() => setMenuId(id));
  };

  const has = (id) => draft?.has(id) || inherited.has(id);
  const list = useMemo(
    () =>
      employees.filter((e) => {
        if (!matchEmployee(e, term, dept)) return false;
        if (show === "has") return has(e.id);
        if (show === "not") return !has(e.id);
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, term, dept, show, draft, inherited],
  );

  const setMany = (ids, value) =>
    setDraft((d) => {
      const n = new Set(d || []);
      for (const id of ids) {
        if (inherited.has(id)) continue;
        if (value) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  const save = useCallback(async () => {
    if (!canEdit || menuId == null || !draft || changes === 0 || saving) return;
    setSaving(true);
    try {
      const { data } = await axios.put("/api/employee-menus", { menuId, employeeIds: [...draft] });
      const byId = new Map(employees.map((e) => [e.id, e.menuCount]));
      const counts = {};
      for (const id of data.added || []) counts[id] = (byId.get(id) ?? 0) + 1;
      for (const id of data.removed || []) counts[id] = Math.max(0, (byId.get(id) ?? 1) - 1);
      onCounts?.(counts);
      setBase(new Set(draft));
      toast.success(`Saved who has ${menu?.title || "this menu"}`);
      const me = meta?.myEmployeeId;
      if (me != null && (data.added?.includes(me) || data.removed?.includes(me))) notifyMenuTreeChanged();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSaving(false);
    }
  }, [canEdit, menuId, draft, changes, saving, employees, onCounts, menu, meta]);

  useEffect(() => {
    const onKey = (e) => {
      if (!isSaveKey(e)) return;
      e.preventDefault();
      save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const directCount = draft ? draft.size : 0;
  const crumbs = menu ? path(tree, menu.id) : [];
  const listIds = list.map((e) => e.id);
  const editableShown = listIds.filter((id) => !inherited.has(id));
  const shownOn = editableShown.filter((id) => draft?.has(id)).length;
  const allState = !editableShown.length || shownOn === 0 ? "off" : shownOn === editableShown.length ? "on" : "mixed";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* left: the menu */}
      <section className={cn(CARD, "min-w-0")}>
        <div className={cn(CARD_HEAD, "flex items-center gap-2")}>
          <ListTree className="h-4 w-4 text-primary" />
          <h2 className="text-[15px] font-semibold text-primary">Which menu?</h2>
        </div>
        {loading ? (
          <ListSkeleton rows={12} />
        ) : (
          <MenuChecklist tree={tree} mode="pick" selectedId={menuId} onPick={pickMenu} maxHeight="max-h-[50vh] lg:max-h-[calc(100vh-300px)]" />
        )}
      </section>

      {/* right: who has it */}
      <section className={cn(CARD, "min-w-0")}>
        <div className={cn(CARD_HEAD, "space-y-2")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Users className="h-4 w-4 flex-shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold text-primary">{menu ? `Who has ${menu.title}` : "Who has it"}</h2>
              {menu && (
                <p className="truncate text-xs text-muted-foreground">
                  {[...crumbs, menu.title].join(" › ")}
                  {menu.url && menu.url !== "#" ? ` · ${menu.url}` : ""}
                </p>
              )}
            </div>
            {draft && (
              <div className="flex flex-wrap gap-1.5">
                <Chip tone="brand">{directCount} direct</Chip>
                {inherited.size > 0 && <Chip tone="muted">{inherited.size} via a menu above</Chip>}
              </div>
            )}
          </div>
          {menu && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[160px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find an employee…" className="h-9 bg-background pl-9" aria-label="Find an employee" />
              </div>
              <div className="min-w-[160px] flex-1">
                <Select
                  aria-label="Department"
                  options={depts}
                  value={depts.find((d) => d.value === dept) || depts[0]}
                  onChange={(o) => setDept(o?.value ?? ALL_DEPTS)}
                  styles={selectStyles(false)}
                  menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                />
              </div>
              <div className="flex rounded-lg border border-border bg-muted/50 p-0.5" role="group" aria-label="Show">
                {SHOW.map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={show === v}
                    onClick={() => setShow(v)}
                    className={cn(
                      "h-8 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors",
                      show === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-primary",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {!menu ? (
          <LabEmpty icon={ListTree} title="Pick a menu" hint="Choose a menu on the left to see who has it, and tick people to give it to them." />
        ) : !draft ? (
          <ListSkeleton rows={10} />
        ) : (
          <>
            <div className="flex items-center gap-2.5 bg-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
              {canEdit && (
                <TriCheck
                  state={allState}
                  label="Tick every employee shown"
                  onChange={(v) => setMany(editableShown, v)}
                  inverted
                />
              )}
              <span className="flex-1">Employee</span>
              <span className="tabular-nums">{list.length}</span>
            </div>
            <div className={cn("max-h-[calc(100vh-360px)] min-h-[200px] overflow-y-auto", busy && "pointer-events-none opacity-60")}>
              {list.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">No employee matches.</p>
              ) : (
                list.map((e) => {
                  const via = inherited.get(e.id);
                  const on = draft.has(e.id) || via != null;
                  const changed = base && base.has(e.id) !== draft.has(e.id);
                  const toggleOne = () => canEdit && via == null && setMany([e.id], !draft.has(e.id));
                  return (
                    <div
                      key={e.id}
                      role="checkbox"
                      aria-checked={on}
                      tabIndex={0}
                      onClick={toggleOne}
                      onKeyDown={(k) => {
                        if (k.key === " " || k.key === "Enter") {
                          k.preventDefault();
                          toggleOne();
                        }
                      }}
                      className={cn(
                        "flex min-h-[48px] items-center gap-2.5 border-b border-border/60 px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                        canEdit && via == null ? "cursor-pointer hover:bg-primary/[0.03]" : "cursor-default",
                        changed && "bg-primary/[0.05]",
                      )}
                    >
                      <TriCheck state={on ? "on" : "off"} disabled={!canEdit || via != null} label={e.name} onChange={toggleOne} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{e.name}</span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className={CODE_CHIP}>{e.code}</span>
                          <span className="truncate">{[e.department, e.role].filter(Boolean).join(" · ")}</span>
                        </span>
                      </span>
                      {via != null && (
                        <span className="inline-flex max-w-[45%] flex-shrink-0 items-center gap-1 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground" title="Given by a menu above — change it on By employee">
                          <Lock className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">via {tree.byId.get(via)?.title || "a menu above"}</span>
                        </span>
                      )}
                      {changed && <Chip tone={draft.has(e.id) ? "ok" : "bad"}>{draft.has(e.id) ? "adding" : "removing"}</Chip>}
                    </div>
                  );
                })
              )}
            </div>
            {canEdit && editableShown.length > 0 && (
              <div className="flex flex-wrap gap-1 border-t border-border bg-muted/40 px-3 py-1.5">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setMany(editableShown, true)}>
                  Tick all shown
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setMany(editableShown, false)}>
                  Untick all shown
                </Button>
              </div>
            )}
            <SaveBar
              changes={changes}
              saving={saving}
              readOnly={!canEdit}
              onUndo={() => setDraft(new Set(base))}
              onSave={save}
              note="Ticking a parent menu gives everything under it"
            />
          </>
        )}
      </section>
    </div>
  );
}
