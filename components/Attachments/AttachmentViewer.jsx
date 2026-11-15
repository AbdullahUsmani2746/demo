"use client";

// components/Attachments/AttachmentViewer.jsx — the attachment gallery.
// Left: every file grouped by where it hangs (the document, then each line).
// Right: the selected file previewed in place — images with zoom / rotate,
// PDFs in the browser's viewer, anything else as a file card. "Full view"
// grows the dialog to the whole screen; ← / → move between files.
//
// Two ways to feed it:
//   voucherId       → loads the document's and its lines' files itself; with
//                     `editable` new files can be added to the document and
//                     files removed (saved immediately).
//   groups          → [{ key, title, subtitle?, files: [url] }] shown as given.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Paperclip,
  RotateCw,
  Trash2,
  UploadCloud,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import AttachmentThumb, { FileTypeTile } from "./AttachmentThumb";
import {
  ATTACHMENT_ACCEPT,
  fetchAttachments,
  fileMeta,
  removeAttachment,
  uploadAttachments,
  urlsOf,
} from "./attachmentUtils";

const KIND_LABEL = { image: "Image", pdf: "PDF document", sheet: "Spreadsheet", doc: "Document", other: "File" };

function groupsFromVoucher(data) {
  return [
    {
      key: "doc",
      title: "Document",
      subtitle: "Attached to the whole voucher",
      target: { voucherId: data.voucherId },
      files: urlsOf(data.attachments),
    },
    ...(data.lines || []).map((l, i) => ({
      key: `line-${l.line_id}`,
      title: l.name || `Line ${i + 1}`,
      subtitle: l.note,
      target: { lineId: l.line_id },
      files: urlsOf(l.attachments),
    })),
  ];
}

function Preview({ url, zoom, rotate }) {
  const { kind, ext, name } = fileMeta(url);

  if (kind === "image") {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:20px_20px] p-4 dark:bg-[repeating-conic-gradient(#0f172a_0%_25%,#1e293b_0%_50%)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={url}
          src={url}
          alt={name}
          style={{ transform: `scale(${zoom}) rotate(${rotate}deg)` }}
          className="max-h-full max-w-full rounded-md object-contain shadow-lg transition-transform duration-200"
        />
      </div>
    );
  }

  if (kind === "pdf") {
    return <iframe key={url} src={`${url}#view=FitH`} title={name} className="h-full w-full bg-white" />;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <FileTypeTile kind={kind} ext={ext} className="h-24 w-20 rounded-xl" iconClassName="h-8 w-8" />
      <div>
        <p className="max-w-md break-all text-base font-semibold">{name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {KIND_LABEL[kind]} — no in-browser preview for this type.
        </p>
      </div>
      <Button asChild>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4" />
          Open file
        </a>
      </Button>
    </div>
  );
}

function ToolButton({ title, onClick, disabled, children, className }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

export default function AttachmentViewer({
  open,
  onOpenChange,
  title = "Attachments",
  subtitle,
  voucherId,
  groups: groupsProp,
  initialUrl,
  editable = false,
  onChange,
}) {
  const [loaded, setLoaded] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const uploadTargetRef = useRef(null);

  const groups = useMemo(() => groupsProp || loaded || [], [groupsProp, loaded]);
  const items = useMemo(
    () => groups.flatMap((g) => g.files.map((url) => ({ url, group: g }))),
    [groups],
  );
  const index = Math.max(0, items.findIndex((it) => it.url === selected));
  const current = items[index] || null;

  // Load (voucherId mode) each time it opens.
  useEffect(() => {
    if (!open || groupsProp || !voucherId) return;
    let cancelled = false;
    setLoading(true);
    fetchAttachments(voucherId)
      .then((data) => !cancelled && setLoaded(groupsFromVoucher(data)))
      .catch((e) => !cancelled && toast.error(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, voucherId, groupsProp]);

  useEffect(() => {
    if (!open) {
      setFull(false);
      setLoaded(null);
      return;
    }
    if (initialUrl) setSelected(initialUrl);
  }, [open, initialUrl]);

  // Keep a valid selection as files come and go.
  useEffect(() => {
    if (items.length && !items.some((it) => it.url === selected)) setSelected(items[0].url);
  }, [items, selected]);

  useEffect(() => {
    setZoom(1);
    setRotate(0);
  }, [selected]);

  const go = useCallback(
    (step) => {
      if (!items.length) return;
      setSelected(items[(index + step + items.length) % items.length].url);
    },
    [items, index],
  );

  const onKeyDown = (e) => {
    if (e.target?.tagName === "INPUT") return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setFull((v) => !v);
    }
  };

  const applyGroupFiles = (groupKey, files) => {
    const next = groups.map((g) => (g.key === groupKey ? { ...g, files } : g));
    setLoaded(next);
    onChange?.(next.reduce((s, g) => s + g.files.length, 0), next);
  };

  const upload = async (fileList, group) => {
    const files = Array.from(fileList || []);
    if (!files.length || !group?.target) return;
    setBusy(true);
    try {
      const res = await uploadAttachments(files, group.target);
      res.errors.forEach((m) => toast.error(m));
      if (res.paths.length) {
        applyGroupFiles(group.key, res.attachments || [...group.files, ...res.paths]);
        setSelected(res.paths[0]);
        toast.success(`${res.paths.length} file${res.paths.length === 1 ? "" : "s"} attached`);
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    if (!item?.group?.target) return;
    if (!window.confirm(`Remove "${fileMeta(item.url).name}"?`)) return;
    setBusy(true);
    try {
      const remaining = await removeAttachment(item.url, item.group.target);
      applyGroupFiles(item.group.key, remaining);
      toast.success("File removed");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pickFor = (group) => {
    uploadTargetRef.current = group;
    inputRef.current?.click();
  };

  const canEdit = editable && !groupsProp;
  const docGroup = groups.find((g) => g.key === "doc");
  const meta = current ? fileMeta(current.url) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(false);
          upload(e.dataTransfer.files, docGroup);
        }}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 [&>button:last-child]:hidden",
          full
            ? "h-[100dvh] w-screen max-w-none rounded-none sm:rounded-none"
            : "h-[88vh] w-[96vw] max-w-6xl sm:rounded-2xl",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            upload(e.target.files, uploadTargetRef.current || docGroup);
            e.target.value = "";
          }}
        />

        {/* ── header ── */}
        <div className="flex items-center justify-between gap-3 border-b bg-gradient-to-r from-slate-50 to-white px-5 py-3 dark:from-slate-900 dark:to-slate-950">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Paperclip className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-bold">{title}</DialogTitle>
              <DialogDescription className="truncate text-xs">
                {subtitle ? `${subtitle} · ` : ""}
                {items.length} file{items.length === 1 ? "" : "s"}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {canEdit && docGroup ? (
              <Button size="sm" variant="outline" className="mr-2 h-8 gap-1.5" disabled={busy} onClick={() => pickFor(docGroup)}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                Add files
              </Button>
            ) : null}
            <ToolButton title={full ? "Exit full view (F)" : "Full view (F)"} onClick={() => setFull((v) => !v)}>
              {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </ToolButton>
            <ToolButton title="Close (Esc)" onClick={() => onOpenChange(false)} className="text-lg leading-none">
              ✕
            </ToolButton>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* ── file rail ── */}
          <aside
            className={cn(
              "shrink-0 overflow-y-auto border-b bg-slate-50/70 dark:bg-slate-900/40 md:border-b-0 md:border-r",
              full ? "max-h-40 md:max-h-none md:w-60" : "max-h-48 md:max-h-none md:w-72",
            )}
          >
            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              groups.map((g) =>
                g.files.length === 0 && g.key !== "doc" ? null : (
                  <section key={g.key} className="px-3 pb-2 pt-3">
                    <div className="mb-1.5 flex items-start justify-between gap-2 px-1">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          {g.title}
                        </p>
                        {g.subtitle ? <p className="truncate text-[11px] text-slate-400">{g.subtitle}</p> : null}
                      </div>
                      <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                        {g.files.length}
                      </span>
                    </div>
                    {g.files.length === 0 ? (
                      <p className="px-1 text-xs text-slate-400">No files</p>
                    ) : (
                      <ul className="space-y-1">
                        {g.files.map((url) => {
                          const m = fileMeta(url);
                          const active = current?.url === url;
                          return (
                            <li key={url}>
                              <button
                                type="button"
                                onClick={() => setSelected(url)}
                                className={cn(
                                  "group flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-all",
                                  active
                                    ? "bg-white shadow-sm ring-2 ring-primary dark:bg-slate-800"
                                    : "hover:bg-white hover:shadow-sm dark:hover:bg-slate-800",
                                )}
                              >
                                <AttachmentThumb url={url} className="h-11 w-11 shrink-0 rounded-md" />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                                    {m.name}
                                  </p>
                                  <p className="text-[10px] font-medium uppercase text-slate-400">{m.ext || "file"}</p>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                ),
              )
            )}
          </aside>

          {/* ── preview ── */}
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950">
            {current ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b bg-white px-3 py-2 dark:bg-slate-900">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{meta.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {KIND_LABEL[meta.kind]} · {current.group.title} · {index + 1} of {items.length}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {meta.kind === "image" ? (
                      <>
                        <ToolButton title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
                          <ZoomOut className="h-4 w-4" />
                        </ToolButton>
                        <button
                          type="button"
                          onClick={() => setZoom(1)}
                          title="Reset zoom"
                          className="w-12 rounded-md py-1 text-center text-xs font-semibold tabular-nums text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {Math.round(zoom * 100)}%
                        </button>
                        <ToolButton title="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
                          <ZoomIn className="h-4 w-4" />
                        </ToolButton>
                        <ToolButton title="Rotate" onClick={() => setRotate((r) => (r + 90) % 360)}>
                          <RotateCw className="h-4 w-4" />
                        </ToolButton>
                        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
                      </>
                    ) : null}
                    <ToolButton title="Open in new tab" onClick={() => window.open(current.url, "_blank", "noopener")}>
                      <ExternalLink className="h-4 w-4" />
                    </ToolButton>
                    {canEdit && current.group.target ? (
                      <ToolButton
                        title="Remove file"
                        onClick={() => remove(current)}
                        disabled={busy}
                        className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </ToolButton>
                    ) : null}
                  </div>
                </div>

                <div className="relative min-h-0 flex-1">
                  <Preview url={current.url} zoom={zoom} rotate={rotate} />
                  {items.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => go(-1)}
                        aria-label="Previous file"
                        className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-lg ring-1 ring-slate-200 backdrop-blur transition hover:scale-105 hover:bg-white dark:bg-slate-800/90 dark:text-slate-100 dark:ring-slate-700"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => go(1)}
                        aria-label="Next file"
                        className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-lg ring-1 ring-slate-200 backdrop-blur transition hover:scale-105 hover:bg-white dark:bg-slate-800/90 dark:text-slate-100 dark:ring-slate-700"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  ) : null}
                </div>
              </>
            ) : (
              !loading && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                    <FileText className="h-7 w-7 text-slate-400" />
                  </span>
                  <p className="text-base font-semibold">No attachments yet</p>
                  {canEdit ? (
                    <>
                      <p className="max-w-xs text-sm text-muted-foreground">
                        Drop files here or add them — they are saved to this voucher straight away.
                      </p>
                      <Button size="sm" onClick={() => pickFor(docGroup)} disabled={busy}>
                        <UploadCloud className="h-4 w-4" />
                        Add files
                      </Button>
                    </>
                  ) : null}
                </div>
              )
            )}

            {dragOver ? (
              <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-primary shadow dark:bg-slate-900">
                  <UploadCloud className="h-4 w-4" /> Drop to attach to the voucher
                </div>
              </div>
            ) : null}
          </main>
        </div>

        <div className="hidden items-center justify-between border-t bg-white px-5 py-2 text-[11px] text-muted-foreground dark:bg-slate-900 md:flex">
          <span>
            <kbd className="rounded border px-1 font-mono">←</kbd> <kbd className="rounded border px-1 font-mono">→</kbd> switch
            file · <kbd className="rounded border px-1 font-mono">F</kbd> full view ·{" "}
            <kbd className="rounded border px-1 font-mono">Esc</kbd> close
          </span>
          {canEdit ? <span>Drag files anywhere onto this window to attach them</span> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
