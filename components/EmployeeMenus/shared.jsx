"use client";
// components/EmployeeMenus/shared.jsx — small pieces both views of
// Settings → Employee menus use: the tri-state tick box, search highlight,
// the menu icon, the sticky save bar and the "unsaved changes" dialog.
import * as Icons from "lucide-react";
import { Check, Loader2, Minus, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export const CARD = "overflow-clip rounded-xl border border-border bg-background";
export const CARD_HEAD = "border-b border-primary/15 bg-primary/5 px-4 py-3";
export const LABEL = "text-[11px] font-bold uppercase tracking-wider text-primary";

// Same lookup as the sidebar / Menus page: a lucide name, else SquareTerminal.
export const iconOf = (name) => (name && /^[A-Z]/.test(name) && Icons[name]) || Icons.SquareTerminal;

/** Tick box with a third, "some of it" state. state: "on" | "off" | "mixed". */
export function TriCheck({ state, onChange, disabled, label, className, inverted = false }) {
  const on = state === "on";
  const mixed = state === "mixed";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!on);
      }}
      className={cn(
        "flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
        inverted
          ? on || mixed
            ? "border-white bg-white text-primary"
            : "border-white/70 bg-transparent hover:border-white"
          : on || mixed
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-background hover:border-primary",
        className,
      )}
    >
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      {mixed && <Minus className="h-3.5 w-3.5" strokeWidth={3} />}
    </button>
  );
}

/** Text with the search term marked. */
export function Highlight({ text, term }) {
  const s = String(text ?? "");
  const q = String(term || "").trim();
  if (!q) return s;
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return s;
  return (
    <>
      {s.slice(0, i)}
      <mark className="rounded bg-primary/15 px-0.5 text-primary">{s.slice(i, i + q.length)}</mark>
      {s.slice(i + q.length)}
    </>
  );
}

/** Sticky footer: "N changes not saved", Undo, Save (Ctrl+S). */
export function SaveBar({ changes, saving, onUndo, onSave, readOnly, note }) {
  if (readOnly) {
    return (
      <div className="sticky bottom-0 z-20 border-t border-border bg-muted/80 px-4 py-2.5 text-[12.5px] text-muted-foreground backdrop-blur">
        Read only — changing menus needs <span className="font-mono">setup.employee_menus.manage</span>.
      </div>
    );
  }
  const dirty = changes > 0;
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t px-4 py-2.5 backdrop-blur transition-colors",
        dirty ? "border-primary/30 bg-primary/[0.06]" : "border-border bg-background/90",
      )}
    >
      <p className={cn("min-w-0 flex-1 text-sm", dirty ? "font-semibold text-primary" : "text-muted-foreground")}>
        {dirty ? `${changes} change${changes === 1 ? "" : "s"} not saved` : note || "All changes saved"}
      </p>
      <div className="flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
        <Button type="button" variant="outline" size="sm" onClick={onUndo} disabled={!dirty || saving}>
          <RotateCcw className="mr-1.5 h-4 w-4" /> Undo
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || saving} title="Save (Ctrl+S)">
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          Save
          <span className="ml-1.5 hidden rounded bg-white/20 px-1 text-[10.5px] font-semibold sm:inline">Ctrl+S</span>
        </Button>
      </div>
    </div>
  );
}

/** "You have unsaved changes" — stay, or leave and drop them. */
export function UnsavedDialog({ open, onStay, onLeave }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onStay()}>
      <AlertDialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>
            The menu changes you made here have not been saved. If you go on, they are dropped.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>Stay here</AlertDialogCancel>
          <AlertDialogAction onClick={onLeave} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Drop changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ListSkeleton({ rows = 8 }) {
  return (
    <div className="space-y-2 p-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-[18px] w-[18px] rounded-[5px]" />
          <Skeleton className="h-4 flex-1" style={{ maxWidth: `${55 + ((i * 17) % 40)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Ctrl/Cmd+S → save, while `enabled`. */
export function isSaveKey(e) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === "s";
}
