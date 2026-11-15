"use client";
// Settings → Employee menus: which menus each employee sees in the sidebar.
//
//   By employee  pick a person, tick their menus in the full active tree
//                (tri-state parents, search, Copy from…, Undo, Save / Ctrl+S)
//   By menu      pick a menu, tick who has it
//
// Data: /api/employee-menus (setup.employee_menus.view / .manage). How ticks
// become employee_menu rows: components/EmployeeMenus/menuTree.js. Leaving
// with unsaved changes asks first (tab, person, menu, any link, closing the tab).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ArrowUpRight, Info, ListTree, RefreshCw, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabHeader, LabEmpty, TABS_LIST, TABS_SCROLL, TABS_TRIGGER } from "@/components/Material/shared/LabUI";
import { buildTree } from "@/components/EmployeeMenus/menuTree";
import { departmentOptions } from "@/components/EmployeeMenus/EmployeePicker";
import ByEmployee from "@/components/EmployeeMenus/ByEmployee";
import ByMenu from "@/components/EmployeeMenus/ByMenu";
import { UnsavedDialog } from "@/components/EmployeeMenus/shared";

export default function EmployeeMenusPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("employee");
  const [pending, setPending] = useState(null); // action waiting on "drop changes?"
  const dirtyRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await axios.get("/api/employee-menus");
      setData(d);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Could not load employee menus");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Keyed on the menu rows only, so a count update after Save does not rebuild
  // the tree (and reload the open employee).
  const menuRows = data?.menus;
  const tree = useMemo(() => (menuRows ? buildTree(menuRows) : null), [menuRows]);
  const employees = useMemo(() => data?.employees || [], [data]);
  const depts = useMemo(() => departmentOptions(employees), [employees]);
  const meta = data?.meta || {};

  const onDirty = useCallback((d) => {
    dirtyRef.current = d;
  }, []);
  const guard = useCallback((fn) => {
    if (dirtyRef.current) setPending(() => fn);
    else fn();
  }, []);
  const onCounts = useCallback((counts) => {
    setData((d) =>
      d ? { ...d, employees: d.employees.map((e) => (counts[e.id] != null ? { ...e, menuCount: counts[e.id] } : e)) } : d,
    );
  }, []);

  // Closing / reloading the tab with unsaved changes: the browser's own prompt.
  useEffect(() => {
    const onUnload = (e) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  // Any in-app link (sidebar, header, breadcrumbs) while there are unsaved
  // changes: hold it and ask.
  useEffect(() => {
    const onClick = (e) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(() => () => router.push(url.pathname + url.search + url.hash));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  const leave = () => {
    const fn = pending;
    dirtyRef.current = false;
    setPending(null);
    fn?.();
  };

  const viewProps = { tree, employees, loading, meta, depts, guard, onDirty, onCounts };

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-5 sm:px-6">
        <LabHeader
          icon={UserCheck}
          breadcrumb="Settings"
          title="Employee menus"
          subtitle="Which menus each employee sees in the sidebar — tick a menu to give it, a parent to give everything under it."
          badge={data ? `${employees.length} employees` : null}
          actions={
            <Button variant="outline" size="sm" onClick={() => guard(load)} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          }
        />

        {error ? (
          <div className="rounded-xl border border-border bg-background">
            <LabEmpty
              icon={Info}
              title="Could not load employee menus"
              hint={error}
              action={
                <Button size="sm" onClick={load} className="mt-2">
                  Try again
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <Tabs value={tab} onValueChange={(v) => v !== tab && guard(() => setTab(v))}>
              <div className={TABS_SCROLL}>
                <TabsList className={TABS_LIST}>
                  <TabsTrigger value="employee" className={TABS_TRIGGER}>
                    <Users className="h-4 w-4" /> By employee
                  </TabsTrigger>
                  <TabsTrigger value="menu" className={TABS_TRIGGER}>
                    <ListTree className="h-4 w-4" /> By menu
                  </TabsTrigger>
                </TabsList>
              </div>
            </Tabs>

            {tab === "employee" ? <ByEmployee key="employee" {...viewProps} /> : <ByMenu key="menu" {...viewProps} />}

            <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 text-[13px]">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
              <div className="min-w-0 space-y-1 text-muted-foreground">
                <p>
                  <span className="font-semibold text-foreground">What else decides the sidebar.</span>{" "}
                  {meta.fullMenuRoles?.length ? (
                    <>
                      People who sign in as <span className="font-semibold text-foreground">{meta.fullMenuRoles.join(" / ")}</span> see every menu whatever is
                      ticked here.{" "}
                    </>
                  ) : null}
                  Menus hidden on Permissions → Menu access stay hidden for that person or role, ticked or not. Switched-off menus are not listed.
                </p>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link href="/admin/permissions?tab=menus" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                    Menu access <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                  <Link href="/accounting/menu" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                    Edit the menu tree <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      <UnsavedDialog open={!!pending} onStay={() => setPending(null)} onLeave={leave} />
    </div>
  );
}
