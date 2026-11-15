"use client";
// components/EmployeeMenus/ByEmployee.jsx — pick an employee, tick their menus.
// The draft is a set of ticked menus; Save sends the smallest covering set of
// rows (menuTree.coverRows) and the server replaces that employee's rows.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Select from "react-select";
import { toast } from "sonner";
import { Copy, ListTree, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { Chip, LabEmpty } from "@/components/Material/shared/LabUI";
import { notifyMenuTreeChanged } from "@/hooks/useMenuTree";
import { changedLeaves, coverRows, expandAssigned, leaves, toggle } from "./menuTree";
import EmployeePicker, { employeeLabel } from "./EmployeePicker";
import MenuChecklist from "./MenuChecklist";
import { CARD, CARD_HEAD, ListSkeleton, SaveBar, isSaveKey } from "./shared";
import { cn } from "@/lib/utils";

const errText = (e) => e?.response?.data?.error || e?.message || "Something went wrong";

export default function ByEmployee({ tree, employees, loading, meta, depts, guard, onDirty, onCounts }) {
  const canEdit = !!meta?.canEdit;
  const [selectedId, setSelectedId] = useState(null);
  const [base, setBase] = useState(null); // ticked set as saved
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const reqRef = useRef(0);

  const employee = employees.find((e) => e.id === selectedId) || null;
  const changes = useMemo(() => (tree && base && draft ? changedLeaves(tree, base, draft).length : 0), [tree, base, draft]);
  useEffect(() => onDirty?.(changes > 0), [changes, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);

  // First employee by default (the list is name-ordered).
  useEffect(() => {
    if (selectedId == null && employees.length) setSelectedId(employees[0].id);
  }, [employees, selectedId]);

  const loadMenus = useCallback(
    async (id) => {
      const { data } = await axios.get("/api/employee-menus", { params: { employeeId: id } });
      return expandAssigned(tree, data.menuIds || []);
    },
    [tree],
  );

  useEffect(() => {
    if (!tree || selectedId == null) return;
    const n = ++reqRef.current;
    setBusy(true);
    setBase(null);
    setDraft(null);
    loadMenus(selectedId)
      .then((t) => {
        if (n !== reqRef.current) return;
        setBase(t);
        setDraft(t);
      })
      .catch((e) => n === reqRef.current && toast.error(errText(e)))
      .finally(() => n === reqRef.current && setBusy(false));
  }, [tree, selectedId, loadMenus]);

  const pick = (id) => {
    if (id === selectedId) return;
    guard(() => setSelectedId(id));
  };

  const save = useCallback(async () => {
    if (!canEdit || !employee || !draft || changes === 0 || saving) return;
    setSaving(true);
    try {
      const { data } = await axios.put("/api/employee-menus", { employeeId: employee.id, menuIds: coverRows(tree, draft) });
      setBase(draft);
      onCounts?.({ [employee.id]: data.menuCount });
      toast.success(`Menus saved for ${employee.name}`);
      if (meta?.myEmployeeId === employee.id) notifyMenuTreeChanged();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSaving(false);
    }
  }, [canEdit, employee, draft, changes, saving, tree, onCounts, meta]);

  // Ctrl+S
  useEffect(() => {
    const onKey = (e) => {
      if (!isSaveKey(e)) return;
      e.preventDefault();
      save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const copyFrom = async (id) => {
    setCopyOpen(false);
    try {
      const t = await loadMenus(id);
      setDraft(t);
      const who = employees.find((e) => e.id === id);
      toast.message(`Loaded ${who?.name || "their"} menus — review, then Save`);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const total = tree ? leaves(tree).length : 0;
  const onCount = draft && tree ? leaves(tree).filter((id) => draft.has(id)).length : 0;
  const fullRole = !!employee?.fullMenu;
  const copyOptions = employees.filter((e) => e.id !== selectedId).map((e) => ({ value: e.id, label: employeeLabel(e) }));

  const toolbar = canEdit && draft && (
    <>
      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setDraft(new Set(tree.byId.keys()))}>
        Select all
      </Button>
      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setDraft(new Set())}>
        None
      </Button>
      <Popover open={copyOpen} onOpenChange={setCopyOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs">
            <Copy className="mr-1 h-3.5 w-3.5" /> Copy from…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-3">
          <p className="mb-2 text-[12.5px] text-muted-foreground">Load another employee&apos;s menus into this draft. Nothing is saved until you press Save.</p>
          <Select
            autoFocus
            options={copyOptions}
            onChange={(o) => o && copyFrom(o.value)}
            placeholder="Pick an employee…"
            styles={selectStyles(false)}
            menuPortalTarget={typeof document !== "undefined" ? document.body : null}
          />
        </PopoverContent>
      </Popover>
    </>
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <EmployeePicker employees={employees} loading={loading} selectedId={selectedId} onSelect={pick} depts={depts} />

      <section className={cn(CARD, "min-w-0")}>
        <div className={cn(CARD_HEAD, "flex flex-wrap items-center gap-x-3 gap-y-1.5")}>
          <ListTree className="h-4 w-4 flex-shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-primary">{employee ? `Menus for ${employee.name}` : "Menus"}</h2>
            {employee && (
              <p className="text-xs text-muted-foreground">
                {[employee.department, employee.role ? `signs in as ${employee.role}` : "no user account"].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          {draft && (
            <Chip tone={onCount ? "brand" : "muted"}>
              {onCount} of {total} menus ticked
            </Chip>
          )}
          {fullRole && (
            <Chip tone="warn">
              <ShieldAlert className="h-3 w-3" /> {employee.role} sees every menu anyway
            </Chip>
          )}
        </div>

        {loading || (!draft && busy) ? (
          <ListSkeleton rows={12} />
        ) : !employee ? (
          <LabEmpty icon={ListTree} title="Pick an employee" hint="Choose someone on the left to see and change the menus they get." />
        ) : !tree || tree.byId.size === 0 ? (
          <LabEmpty icon={ListTree} title="No active menus" hint="Add or switch on menus on the Menus page first." />
        ) : (
          <div className={cn(busy && "pointer-events-none opacity-60")}>
            <MenuChecklist
              tree={tree}
              mode="check"
              ticked={draft || new Set()}
              readOnly={!canEdit}
              onToggle={(id, v) => setDraft((d) => toggle(tree, d || new Set(), id, v))}
              toolbar={toolbar}
            />
          </div>
        )}

        {employee && draft && (
          <SaveBar changes={changes} saving={saving} readOnly={!canEdit} onUndo={() => setDraft(base)} onSave={save} />
        )}
      </section>
    </div>
  );
}
