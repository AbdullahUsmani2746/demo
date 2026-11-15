"use client";

// components/Attachments/AttachmentDropzone.jsx — drop / browse files, see
// them as thumbnails, preview or remove each.
//
// Files upload the moment they are picked. With `target` ({ voucherId } or
// { lineId }) they are saved onto that document / line right away (Invoicing,
// where the document already exists); without one they are only uploaded and
// `onChange` hands back the URL list for the form to save with the voucher.

import { useRef, useState } from "react";
import { Eye, Loader2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import AttachmentThumb from "./AttachmentThumb";
import AttachmentViewer from "./AttachmentViewer";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_MB,
  fileMeta,
  removeAttachment,
  uploadAttachments,
  urlsOf,
} from "./attachmentUtils";

export default function AttachmentDropzone({
  value,
  onChange,
  target,
  disabled = false,
  compact = false,
  label = "Attachments",
  hint,
  className,
}) {
  const files = urlsOf(value);
  // Uploads finish later — append to the list as it is then, not as it was.
  const filesRef = useRef(files);
  filesRef.current = files;
  const inputRef = useRef(null);
  const [pending, setPending] = useState([]);
  const [removing, setRemoving] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [viewing, setViewing] = useState(null);

  const upload = async (fileList) => {
    const picked = Array.from(fileList || []);
    if (!picked.length || disabled) return;
    const names = picked.map((f) => f.name);
    setPending((p) => [...p, ...names]);
    try {
      const res = await uploadAttachments(picked, target);
      res.errors.forEach((m) => toast.error(m));
      if (res.paths.length) {
        onChange?.(res.attachments || [...filesRef.current, ...res.paths]);
        toast.success(`${res.paths.length} file${res.paths.length === 1 ? "" : "s"} attached`);
      }
    } catch (e) {
      toast.error(e.message || "Upload failed");
    } finally {
      setPending((p) => p.filter((n) => !names.includes(n)));
    }
  };

  const remove = async (url) => {
    if (disabled) return;
    if (!target) {
      onChange?.(files.filter((u) => u !== url));
      return;
    }
    if (!window.confirm(`Remove "${fileMeta(url).name}"?`)) return;
    setRemoving(url);
    try {
      onChange?.(await removeAttachment(url, target));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRemoving(null);
    }
  };

  const busy = pending.length > 0;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(false);
          upload(e.dataTransfer.files);
        }}
        className={cn(
          "group flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed transition-all outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
          compact ? "px-3 py-2.5" : "px-4 py-4",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-slate-300 bg-slate-50/60 hover:border-primary/60 hover:bg-white dark:border-slate-700 dark:bg-slate-900/40 dark:hover:bg-slate-900",
          disabled && "cursor-not-allowed opacity-60 hover:border-slate-300 hover:bg-slate-50/60",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105",
            compact ? "h-8 w-8" : "h-10 w-10",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className={compact ? "h-4 w-4" : "h-5 w-5"} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {busy ? `Uploading ${pending.length} file${pending.length === 1 ? "" : "s"}…` : (
              <>
                <span className="text-primary">Click to upload</span> or drag & drop
              </>
            )}
          </p>
          <p className="truncate text-xs text-slate-500">
            {hint || `PDF, images, Word, Excel · up to ${MAX_ATTACHMENT_MB} MB each`}
          </p>
        </div>
        {files.length > 0 ? (
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
            {files.length}
          </span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 || pending.length > 0 ? (
        <ul className={cn("grid gap-2", compact ? "grid-cols-[repeat(auto-fill,minmax(88px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(104px,1fr))]")}>
          {files.map((url) => {
            const m = fileMeta(url);
            return (
              <li
                key={url}
                className="group/card relative overflow-hidden rounded-lg border bg-white shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
              >
                <button
                  type="button"
                  onClick={() => setViewing(url)}
                  title={`Preview ${m.name}`}
                  className="block w-full text-left"
                >
                  <AttachmentThumb url={url} className="aspect-[4/3] w-full" />
                  <p className="truncate px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200">{m.name}</p>
                  <span className="absolute inset-x-0 top-0 flex aspect-[4/3] items-center justify-center bg-slate-900/0 text-white opacity-0 transition group-hover/card:bg-slate-900/40 group-hover/card:opacity-100">
                    <Eye className="h-5 w-5" />
                  </span>
                </button>
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => remove(url)}
                    disabled={removing === url}
                    title="Remove"
                    aria-label={`Remove ${m.name}`}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-slate-600 opacity-0 shadow ring-1 ring-slate-200 transition hover:bg-rose-500 hover:text-white group-hover/card:opacity-100 focus:opacity-100"
                  >
                    {removing === url ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
              </li>
            );
          })}
          {pending.map((name, i) => (
            <li key={`${name}-${i}`} className="overflow-hidden rounded-lg border border-dashed bg-slate-50 dark:bg-slate-900/40">
              <div className="flex aspect-[4/3] items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
              <p className="truncate px-2 py-1 text-[11px] text-slate-500">{name}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <AttachmentViewer
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        title={label}
        groups={[{ key: "files", title: label, files }]}
        initialUrl={viewing}
      />
    </div>
  );
}
