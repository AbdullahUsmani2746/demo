"use client";
// The signed-in user's report Display settings (lib/reports/displayPrefs.js).
// Draws at once from this browser's copy, then takes the account copy from
// /api/reports/display; a change applies at once (every formatter reads it via
// setReportDisplay) and is saved to the account half a second later, so the
// same settings follow the person to any PC or phone.
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { cleanDisplay } from "@/lib/reports/displayPrefs";
import { setReportDisplay } from "@/components/Reports/layout";

const LOCAL_KEY = "ebizz.reportDisplay.v1";

const readLocal = () => {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? cleanDisplay(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};
const writeLocal = (d) => {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(d));
  } catch {
    // private window / blocked storage — the account copy still has it
  }
};

export function useReportDisplay() {
  const [display, setDisplay] = useState(() => {
    const d = typeof window === "undefined" ? cleanDisplay({}) : readLocal() || cleanDisplay({});
    setReportDisplay(d);
    return d;
  });
  const saveTimer = useRef(null);
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    axios
      .get("/api/reports/display")
      .then((res) => {
        if (cancelled || touched.current || !res.data?.saved) return;
        const d = cleanDisplay(res.data.display);
        setReportDisplay(d);
        writeLocal(d);
        setDisplay(d);
      })
      .catch(() => {
        // offline / not signed in — the browser copy stays
      });
    return () => {
      cancelled = true;
      clearTimeout(saveTimer.current);
    };
  }, []);

  const update = useCallback((patch) => {
    touched.current = true;
    setDisplay((prev) => {
      const next = cleanDisplay(typeof patch === "function" ? patch(prev) : { ...prev, ...patch });
      setReportDisplay(next);
      writeLocal(next);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        axios.put("/api/reports/display", { display: next }).catch(() => {});
      }, 500);
      return next;
    });
  }, []);

  return [display, update];
}
