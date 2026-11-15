// components/Material/Production/ConfirmDialog.jsx
// Promise-based replacement for window.confirm():
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm({ title, description, confirmLabel }))) return;
//   …render {confirmDialog} somewhere in the tree.
"use client";
import React, { useCallback, useRef, useState } from "react";
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
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import { cn } from "@/lib/utils";

export function useConfirm() {
  const [state, setState] = useState(null); // { title, description, confirmLabel, destructive }
  const resolver = useRef(null);

  const settle = useCallback((answer) => {
    resolver.current?.(answer);
    resolver.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((opts) => {
    resolver.current?.(false);
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState(opts || {});
    });
  }, []);

  // Capture: Esc answers this dialog only — not the process order behind it.
  useKeyboardShortcuts({ escape: { handler: () => settle(false), allowInInput: true } }, !!state, true);

  const dialog = (
    <AlertDialog open={!!state} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title || "Are you sure?"}</AlertDialogTitle>
          {state?.description && <AlertDialogDescription>{state.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={cn(state?.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {state?.confirmLabel || "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return [confirm, dialog, !!state];
}

export default useConfirm;
