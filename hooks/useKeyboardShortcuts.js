// components/Material/Production/useKeyboardShortcuts.js
"use client";
import { useEffect, useRef } from "react";

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    // react-select renders its search box inside a div with this class
    !!el.closest?.(".react-select__control")
  );
};

/**
 * Binds a map of keyboard shortcuts to the document.
 *
 * Key format: "alt+n", "alt+c", "alt+m", "ctrl+s", "shift+?", "escape", "/".
 * Ctrl and Meta are treated as the same modifier so Mac and Windows both work.
 *
 * Each value is either a handler function or
 * `{ handler, allowInInput }` — set `allowInInput` for shortcuts that must
 * still fire while the user is typing in a field (e.g. Ctrl+S to save).
 *
 * Pass `capture: true` for a nested overlay so its keys win over the shortcuts
 * of whatever is behind it, regardless of which mounted first.
 */
export const useKeyboardShortcuts = (shortcuts, enabled = true, capture = false) => {
  // Keep the latest handlers without rebinding the listener on every render
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event) => {
      const map = shortcutsRef.current || {};
      const key = (event.key || "").toLowerCase();
      const mod = event.ctrlKey || event.metaKey;

      // Build the combo string in a fixed order: ctrl -> alt -> shift -> key
      const combo = [
        mod ? "ctrl" : "",
        event.altKey ? "alt" : "",
        event.shiftKey ? "shift" : "",
        key,
      ]
        .filter(Boolean)
        .join("+");

      const entry = map[combo] ?? map[key];
      if (!entry) return;

      const handler = typeof entry === "function" ? entry : entry.handler;
      const allowInInput =
        typeof entry === "function" ? false : !!entry.allowInInput;
      if (!handler) return;

      // Plain keys and Alt combos must not hijack typing; Ctrl combos may.
      if (!allowInInput && !mod && isTypingTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      handler(event);
    };

    document.addEventListener("keydown", handleKeyDown, capture);
    return () => document.removeEventListener("keydown", handleKeyDown, capture);
  }, [enabled, capture]);
};

export default useKeyboardShortcuts;
