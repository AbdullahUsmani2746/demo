"use client";

import { useEffect, useState } from "react";
import axios from "axios";

// Loads the menus linked to this employee in employee_menu, plus their
// descendants — the same source app-sidebar.jsx uses for employee roles.
//
// Pass { all: true } to load the entire menus table instead, ignoring
// employee_menu. That is reserved for roles whose Sidebar is "whole menu" (see
// lib/menu/appMenuSettings.js), which are meant to reach every module without
// anyone having to link menus to them first. For every other role there is
// deliberately no "show everything" mode: a user with no rows in employee_menu
// sees nothing, which is the correct answer rather than a bug.
// Fired after a screen changes the menus someone sees (Settings → Employee
// menus): every mounted useMenuTree reloads, so the signed-in person's sidebar
// follows their own change without a page refresh.
export const MENU_TREE_CHANGED = "menu-tree:changed";
export function notifyMenuTreeChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MENU_TREE_CHANGED));
}

export function useMenuTree(employeeId, { all = false } = {}) {
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(MENU_TREE_CHANGED, bump);
    return () => window.removeEventListener(MENU_TREE_CHANGED, bump);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      if (!all && !employeeId) {
        if (!cancelled) {
          setMenus([]);
          setLoading(false);
        }
        return;
      }

      try {
        const url = all
          ? "/api/buildMenu?all=true"
          : `/api/buildMenu?employeeId=${employeeId}`;
        const res = await axios.get(url);
        if (!cancelled) setMenus(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        console.error("Error loading menu tree:", err);
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [employeeId, all, version]);

  return { menus, loading, error };
}
