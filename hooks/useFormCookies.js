import { useEffect, useRef, useCallback } from "react";

const STORAGE_KEY_PREFIX = "voucherForm_";

/**
 * Form data persistence hook using localStorage.
 *
 * WHY localStorage?
 *   Cookies = 4KB max (silently fails on large forms). localStorage = 5MB.
 *   Both survive page refresh AND browser close/reopen.
 *
 * FAILURE MODES COVERED:
 *
 *  1. User types → switches browser tabs → Chrome Memory Saver discards tab → page reloads.
 *     Fix: `visibilitychange` listener saves immediately when tab goes to background.
 *     On reload, initFormData calls loadFromStorage() and restores.
 *
 *  2. User types → navigates to another page in the same app → comes back.
 *     Fix: `beforeunload` + `visibilitychange` listeners cover this.
 *     On re-open of the form, initFormData restores from localStorage.
 *
 *  3. Parent component re-renders → passes new `existingData={}` reference →
 *     initFormData re-runs → overwrites user's typed data.
 *     Fix: initContextRef guard in Form.jsx (see changes there).
 *
 *  4. React race condition: first render has empty state ({}, [{}]) → auto-save
 *     fires BEFORE initFormData loads real data → overwrites localStorage with empties.
 *     Fix: isInitializedRef — auto-save is blocked until markInitialized() is called
 *     at the END of initFormData.
 *
 * SAVE TRIGGERS (all three must be covered):
 *   a. Every state change while form is open (auto-save useEffect)
 *   b. When user switches to another tab (visibilitychange: hidden)
 *   c. When page is about to close or navigate (beforeunload / pagehide)
 *
 * CLEAR TRIGGER:
 *   Only after a successful "Save Only" or "Print & Save".
 */
export const useFormCookies = (
  formType,
  masterData,
  mainLines,
  deductionLines,
  mode,
  editId,
  isEditMode,      // editMode prop — prevents saving in edit mode
  hasOriginalData, // !!originalData — prevents saving in return/copy mode
  draftScope = null // source doc id (e.g. SO no) when creating a child doc from a row
) => {
  // A child doc opened from a source row (SO → Dispatch, PO → GRN) arrives with
  // editMode=true + mode="create". Those get their own draft slot per source doc,
  // so SO 10133's half-done dispatch never collides with SO 10132's.
  const isCreateFromSource = isEditMode && mode === "create";
  const storageKey = isCreateFromSource
    ? `${STORAGE_KEY_PREFIX}${formType}__src_${draftScope}`
    : `${STORAGE_KEY_PREFIX}${formType}`;

  // Persist for brand-new forms and for create-from-source once its scope is
  // known (existingData is populated async — never write to an unscoped key).
  // Never for real edits or return/copy mode.
  const shouldPersist =
    !hasOriginalData &&
    (!isEditMode || (isCreateFromSource && draftScope != null && draftScope !== ""));

  // Guards the auto-save effect — nothing writes until markInitialized() is called.
  // This prevents the initial empty state ({}, [{}]) from overwriting real saved data.
  const isInitializedRef = useRef(false);

  // Slot the form is currently persisting to. When it changes (the same mounted
  // form is handed a different SO/PO), persistence is switched off until
  // initFormData re-seeds for the new slot and calls markInitialized() again —
  // otherwise the previous doc's on-screen state would be written into the new slot.
  const activeKeyRef = useRef(storageKey);
  if (activeKeyRef.current !== storageKey) {
    activeKeyRef.current = storageKey;
    isInitializedRef.current = false;
  }

  // Keep the LATEST form values accessible to event handlers via refs.
  // Closures in addEventListener callbacks would capture stale state — refs solve this.
  const latestRef = useRef({ masterData, mainLines, deductionLines });
  latestRef.current = { masterData, mainLines, deductionLines }; // update every render (no cost)

  // ─── CORE SAVE FUNCTION ───────────────────────────────────────────────────
  const saveToStorage = useCallback((master, lines, deductions) => {
    if (!shouldPersist || !formType) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        masterData: master,
        mainLines: lines,
        deductionLines: deductions,
        formType,
        savedAt: Date.now(),
      }));
    } catch (error) {
      console.error("[useFormCookies] localStorage write failed:", error);
    }
  }, [storageKey, formType, shouldPersist]);

  // ─── AUTO-SAVE ON STATE CHANGES ───────────────────────────────────────────
  // Fires after every React render where form state changed.
  // Blocked by isInitializedRef until initFormData completes its first run.
  useEffect(() => {
    if (!isInitializedRef.current) return;
    saveToStorage(masterData, mainLines, deductionLines);
  }, [masterData, mainLines, deductionLines, saveToStorage]);

  // ─── EMERGENCY SAVE: TAB SWITCH + PAGE CLOSE ──────────────────────────────
  // These cover the cases where React's effect scheduler may not have flushed yet:
  //   - Chrome Memory Saver discards the tab while it's in the background
  //   - User navigates away (Next.js router or browser back)
  //   - Browser/tab is closed
  useEffect(() => {
    if (!shouldPersist) return;

    const saveLatest = () => {
      // Only save if form has been initialized (markInitialized was called)
      if (!isInitializedRef.current) return;
      const { masterData: m, mainLines: ml, deductionLines: dl } = latestRef.current;
      saveToStorage(m, ml, dl);
    };

    // Fires when tab goes to background (user switches tabs, minimizes, etc.)
    // This is the MOST IMPORTANT handler for the "switching tabs" scenario.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveLatest();
      }
    };

    // Fires just before the page unloads (navigation, browser close, refresh)
    const handleBeforeUnload = () => saveLatest();

    // pagehide covers mobile browsers and some edge cases beforeunload misses
    const handlePageHide = () => saveLatest();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [shouldPersist, saveToStorage]);

  // ─── LOAD ─────────────────────────────────────────────────────────────────
  // Pure read — called manually from initFormData. No side effects.
  const loadFromStorage = useCallback(() => {
    if (!shouldPersist) {
      return { masterData: null, mainLines: null, deductionLines: null, hasRestoredData: false };
    }
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          parsed.formType === formType &&
          parsed.masterData &&
          Object.keys(parsed.masterData).length > 0
        ) {
          return {
            masterData: parsed.masterData,
            mainLines: Array.isArray(parsed.mainLines) && parsed.mainLines.length > 0
              ? parsed.mainLines : [{}],
            deductionLines: Array.isArray(parsed.deductionLines) && parsed.deductionLines.length > 0
              ? parsed.deductionLines : [{}],
            hasRestoredData: true,
          };
        }
      }
    } catch (error) {
      console.error("[useFormCookies] localStorage read failed:", error);
    }
    return { masterData: null, mainLines: null, deductionLines: null, hasRestoredData: false };
  }, [storageKey, formType, shouldPersist]);

  // ─── MARK INITIALIZED ─────────────────────────────────────────────────────
  // Call this at the END of the new-form branch in initFormData.
  // After this, auto-save and emergency-save are both active.
  const markInitialized = useCallback(() => {
    isInitializedRef.current = true;
  }, []);

  // ─── CLEAR ────────────────────────────────────────────────────────────────
  // Drops the stored draft but keeps persisting — used by "Discard Draft",
  // where the user carries on editing the same form.
  const clearFromStorage = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error("[useFormCookies] localStorage clear failed:", error);
    }
  }, [storageKey]);

  // ─── FINALIZE ─────────────────────────────────────────────────────────────
  // Call after "Save Only" success AND "Print & Save" success. Clears the draft
  // AND stops persisting, so the tab-switch / print-dialog / unload handlers
  // can't re-write the just-saved doc as a draft.
  const finalizeDraft = useCallback(() => {
    isInitializedRef.current = false;
    clearFromStorage();
  }, [clearFromStorage]);

  return { loadFromStorage, clearFromStorage, finalizeDraft, markInitialized };
};
