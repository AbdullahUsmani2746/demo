// components/Material/Production/KeyboardHint.jsx
"use client";
import React, { useState } from "react";
import { Keyboard, X } from "lucide-react";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";

/** A single <kbd> chip, e.g. <Kbd>Alt</Kbd><Kbd>N</Kbd> */
export const Kbd = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded border border-border bg-muted text-[10px] font-mono font-semibold text-foreground shadow-sm">
    {children}
  </kbd>
);

/** Renders "Alt+N" as chips. */
export const KeyCombo = ({ combo }) => (
  <span className="inline-flex items-center gap-0.5">
    {combo.split("+").map((part, i) => (
      <React.Fragment key={part + i}>
        {i > 0 && <span className="text-muted-foreground text-[10px]">+</span>}
        <Kbd>{part}</Kbd>
      </React.Fragment>
    ))}
  </span>
);

/**
 * A "?" button that opens a shortcut cheat-sheet.
 * `shortcuts` is an array of { combo, label } (optionally { group }).
 */
const KeyboardHint = ({ shortcuts = [], className = "" }) => {
  const [open, setOpen] = useState(false);

  // "?" opens the cheat sheet from anywhere.
  useKeyboardShortcuts({
    "shift+?": () => setOpen((prev) => !prev),
    "?": () => setOpen((prev) => !prev),
  });

  // Escape is only claimed while the sheet is open, so it keeps closing
  // the surrounding modal the rest of the time.
  useKeyboardShortcuts({ escape: () => setOpen(false) }, open, true);

  if (shortcuts.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts (Shift + ?)"
        aria-label="Show keyboard shortcuts"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors text-xs font-medium ${className}`}
      >
        <Keyboard size={14} />
        <span className="hidden sm:inline">Shortcuts</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md bg-card rounded-2xl shadow-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-primary">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <Keyboard size={16} />
                Keyboard Shortcuts
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-white/80 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 max-h-[60vh] overflow-y-auto">
              <dl className="space-y-1">
                {shortcuts.map(({ combo, label }) => (
                  <div
                    key={combo + label}
                    className="flex items-center justify-between gap-4 px-2 py-1.5 rounded-lg hover:bg-muted/50"
                  >
                    <dt className="text-xs text-foreground">{label}</dt>
                    <dd className="flex-shrink-0">
                      <KeyCombo combo={combo} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="px-5 py-3 border-t border-border bg-muted/30">
              <p className="text-[11px] text-muted-foreground">
                On Mac use <Kbd>⌘</Kbd> in place of <Kbd>Ctrl</Kbd>.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default KeyboardHint;
