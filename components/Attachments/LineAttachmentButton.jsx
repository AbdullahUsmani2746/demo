"use client";

// components/Attachments/LineAttachmentButton.jsx — the paperclip on a line.
// Shows how many files the line has; opens a small window to add, preview or
// remove them. `target` ({ lineId }) saves straight onto a stored line;
// without it the URLs go back through `onChange` and are saved with the form.

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import AttachmentDropzone from "./AttachmentDropzone";
import { urlsOf } from "./attachmentUtils";

export default function LineAttachmentButton({
  value,
  onChange,
  target,
  disabled = false,
  lineLabel,
  className,
}) {
  const [open, setOpen] = useState(false);
  const count = urlsOf(value).length;
  // Read-only and nothing attached: nothing to open.
  const inert = disabled && count === 0;

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        disabled={inert}
        onClick={() => setOpen(true)}
        title={count ? `${count} file${count === 1 ? "" : "s"} attached to this line` : "Attach files to this line"}
        aria-label={count ? `${count} line attachments` : "Attach files to this line"}
        className={cn(
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all",
          count
            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
            : "border-transparent text-slate-400 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200",
          inert && "pointer-events-none opacity-30",
          className,
        )}
      >
        <Paperclip className="h-4 w-4" />
        {count ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground ring-2 ring-white dark:ring-slate-900">
            {count}
          </span>
        ) : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl gap-3 sm:rounded-2xl">
          <div className="flex items-center gap-3 pr-8">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Paperclip className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold">Line attachments</DialogTitle>
              <DialogDescription className="truncate text-xs">
                {lineLabel || "Files for this line only"}
              </DialogDescription>
            </div>
          </div>
          <AttachmentDropzone
            value={value}
            onChange={onChange}
            target={target}
            disabled={disabled}
            label="Line attachments"
            hint={target ? "Saved to this line straight away" : "Saved with the voucher"}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
