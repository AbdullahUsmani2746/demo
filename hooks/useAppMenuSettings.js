"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";

import {
  DEFAULT_APP_MENU_SETTINGS,
  normalizeAppMenuSettings,
} from "@/lib/menu/appMenuSettings";

// Reads and writes the two Applications-page settings held in the Settings
// table. Falls back to defaults on any failure so the page always renders.
export function useAppMenuSettings() {
  const [settings, setSettings] = useState(DEFAULT_APP_MENU_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await axios.get("/api/settings/app-menu");
        if (!cancelled) setSettings(normalizeAppMenuSettings(res.data?.data));
      } catch (err) {
        console.error("Failed to load app menu settings:", err);
        if (!cancelled) setSettings(DEFAULT_APP_MENU_SETTINGS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (patch) => {
    // Apply immediately so the grid reflows without waiting on the round trip.
    setSettings((current) => normalizeAppMenuSettings({ ...current, ...patch }));
    setSaving(true);

    try {
      const res = await axios.put("/api/settings/app-menu", patch);
      setSettings(normalizeAppMenuSettings(res.data?.data));
      return { ok: true };
    } catch (err) {
      console.error("Failed to save app menu setting:", err);
      return { ok: false, error: err?.response?.data?.error || "Could not save setting" };
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, loading, saving, update };
}
