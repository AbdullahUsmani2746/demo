"use client";

// components/Attachments/AttachmentThumb.jsx — a square preview of one stored
// file: the image itself, or a coloured tile with the file type.

import { useState } from "react";
import { FileImage, FileSpreadsheet, FileText, File as FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileMeta } from "./attachmentUtils";

export const KIND_STYLE = {
  pdf: { icon: FileText, tile: "bg-rose-50 text-rose-600 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900" },
  sheet: { icon: FileSpreadsheet, tile: "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900" },
  doc: { icon: FileText, tile: "bg-sky-50 text-sky-600 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900" },
  image: { icon: FileImage, tile: "bg-violet-50 text-violet-600 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900" },
  other: { icon: FileIcon, tile: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700" },
};

export function FileTypeTile({ kind, ext, className, iconClassName }) {
  const style = KIND_STYLE[kind] || KIND_STYLE.other;
  const Icon = style.icon;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-0.5 ring-1 ring-inset", style.tile, className)}>
      <Icon className={cn("h-5 w-5", iconClassName)} />
      {ext ? <span className="text-[9px] font-bold uppercase tracking-wider">{ext.slice(0, 4)}</span> : null}
    </div>
  );
}

export default function AttachmentThumb({ url, className }) {
  const { kind, ext, name } = fileMeta(url);
  const [broken, setBroken] = useState(false);

  if (kind === "image" && !broken) {
    return (
      <div className={cn("overflow-hidden bg-slate-100 dark:bg-slate-800", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  return <FileTypeTile kind={kind} ext={ext} className={className} />;
}
