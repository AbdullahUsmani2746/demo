"use client";
// Overview of every notification event and the editor for its wording.
// Used by components/Settings/NotificationSettings.jsx (Admin → Notifications,
// and the Notifications tab of Settings).
//
//   EventOverview — one card per event: on/off, notify-the-doer, who receives
//                   it, and the text people currently get
//   TemplateSheet — side sheet to write the title / message with {placeholders}
//                   (lib/notifications/template.js), live preview, reset
//
// The texts are templates only: who receives an event is still the routing
// (roles / users) the same screen edits.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Bell, Check, Info, Loader2, Lock, PencilLine, RotateCcw, Sparkles, UserCog,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { renderTemplate, templateVarNames, isBlankTemplate } from "@/lib/notifications/template";

// Sample values for the preview. A placeholder with no sample shows as [name].
const SAMPLE = {
  actor: "Ayesha Khan",
  voucher_type: "Receipt Voucher",
  vr_no: "1024",
  items: "6",
  ref: "Dispatch #311",
  so_no: "2087",
  customer: "ABC Traders",
  party: "ABC Traders",
  kind: "Free of Cost",
  remarks: "Damaged in transit",
  order_no: "2087",
  order_type: "Sales Order",
  approver: "Bilal Ahmed",
  reason: "Price not agreed",
  requester: "Ayesha Khan",
  type: "Leave application",
  summary: "3 days annual leave",
  id: "R-58",
  rule: "Leave approval",
  decision: "Approved",
  count: "3",
  list: "ABC Traders (2d); XYZ Mills (5d)",
};

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const hasTemplate = (e) => !isBlankTemplate(e.title_template) || !isBlankTemplate(e.message_template);

/** The title / message a user would see today: the template (with sample values) or the last real one. */
function currentText(event) {
  if (hasTemplate(event)) {
    return {
      kind: "custom",
      title: event.title_template || event.last_sent?.title || null,
      message: event.message_template || event.last_sent?.message || null,
    };
  }
  if (event.last_sent) return { kind: "last", title: event.last_sent.title, message: event.last_sent.message, at: event.last_sent.at };
  return { kind: "default", title: null, message: null };
}

// ─── Overview ────────────────────────────────────────────────────────────────
export function EventOverview({ grouped, roleLabel, onToggleActive, onToggleActor, onOpenUsers, onEditText }) {
  if (grouped.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No events match your search.</p>;
  }
  return (
    <div className="space-y-6">
      {grouped.map(([category, events]) => (
        <section key={category} className="overflow-hidden rounded-xl border border-border bg-background">
          <header className="flex items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
            <h3 className="text-[15px] font-semibold text-primary">{category}</h3>
            <span className="text-xs text-muted-foreground">
              {events.filter((e) => e.is_active).length}/{events.length} on
            </span>
          </header>
          <ul className="divide-y divide-border/60">
            {events.map((e) => (
              <EventRow
                key={e.code}
                event={e}
                roleLabel={roleLabel}
                onToggleActive={onToggleActive}
                onToggleActor={onToggleActor}
                onOpenUsers={onOpenUsers}
                onEditText={onEditText}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EventRow({ event: e, roleLabel, onToggleActive, onToggleActor, onOpenUsers, onEditText }) {
  const text = currentText(e);
  const always = e.users.filter((u) => u.state === "always").length;
  const never = e.users.filter((u) => u.state === "never").length;

  return (
    <li className={`grid grid-cols-1 gap-4 px-4 py-4 transition-colors hover:bg-primary/[0.03] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] lg:items-start ${e.is_active ? "" : "opacity-60"}`}>
      {/* what + who */}
      <div className="min-w-0 space-y-2">
        <div>
          <div className="font-semibold leading-snug text-foreground">{e.label}</div>
          {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {e.roles.length === 0 && always === 0 ? (
            <span className="text-xs text-muted-foreground">No role subscribed — only the people the document concerns</span>
          ) : (
            e.roles.map((r) => (
              <span key={r} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {roleLabel(r)}
              </span>
            ))
          )}
          <button
            type="button"
            onClick={() => onOpenUsers(e)}
            disabled={!e.is_active}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:pointer-events-none"
          >
            <UserCog className="h-3 w-3" />
            {always || never ? `${always ? `+${always}` : ""}${always && never ? " · " : ""}${never ? `−${never} muted` : ""}` : "People"}
          </button>
        </div>
      </div>

      {/* the text */}
      <button
        type="button"
        onClick={() => onEditText(e)}
        className="group min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/5"
      >
        <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          {text.kind === "custom" ? (
            <span className="inline-flex items-center gap-1 font-medium text-primary">
              <Sparkles className="h-3 w-3" /> Custom text
            </span>
          ) : text.kind === "last" ? (
            <span>System text · last sent {fmtDate(text.at)}</span>
          ) : (
            <span>System text</span>
          )}
          <PencilLine className="ml-auto h-3.5 w-3.5 text-primary opacity-0 transition group-hover:opacity-100" />
        </div>
        {text.title || text.message ? (
          <>
            <div className="truncate text-sm font-medium">{text.title}</div>
            <div className="line-clamp-2 text-xs text-muted-foreground">{text.message}</div>
          </>
        ) : (
          <div className="text-xs italic text-muted-foreground">Written by the system when it happens — not sent yet</div>
        )}
      </button>

      {/* switches */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:flex-col lg:items-end">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          On
          <Switch checked={e.is_active} onCheckedChange={(v) => onToggleActive(e, v)} />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground" title="Also tell the person who did it">
          Tell the doer
          <Switch checked={e.notify_actor} disabled={!e.is_active} onCheckedChange={(v) => onToggleActor(e, v)} />
        </label>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-background lg:hidden" onClick={() => onEditText(e)}>
          <PencilLine className="h-3.5 w-3.5" /> Edit text
        </Button>
      </div>
    </li>
  );
}

// ─── Template editor ─────────────────────────────────────────────────────────
export function TemplateSheet({ event, open, onOpenChange, meta, onSave, saving }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [field, setField] = useState("message");
  const titleRef = useRef(null);
  const messageRef = useRef(null);

  useEffect(() => {
    if (!event) return;
    setTitle(event.title_template || "");
    setMessage(event.message_template || "");
    setField("message");
  }, [event?.code, event?.title_template, event?.message_template]); // eslint-disable-line react-hooks/exhaustive-deps

  const vars = useMemo(() => [...(meta.commonVars || []), ...(event?.vars || [])], [meta.commonVars, event?.vars]);
  const known = useMemo(() => new Set(vars.map((v) => v.name)), [vars]);
  const unknown = useMemo(
    () => [...new Set([...templateVarNames(title), ...templateVarNames(message)])].filter((n) => !known.has(n)),
    [title, message, known],
  );

  if (!event) return null;

  const limits = meta.templateLimits || { title: 200, message: 500 };
  const readOnly = !meta.canEditTemplates || !meta.templatesReady;
  const dirty = (title.trim() || null) !== (event.title_template || null) || (message.trim() || null) !== (event.message_template || null);

  // Preview: sample values; {title}/{message} = the last real text or the event's own name.
  const defTitle = event.last_sent?.title || event.label;
  const defMessage = event.last_sent?.message || event.description || event.label;
  const sample = Object.fromEntries(vars.map((v) => [v.name, SAMPLE[v.name] ?? `[${v.name}]`]));
  Object.assign(sample, { title: defTitle, message: defMessage });
  const previewTitle = renderTemplate(title, sample, limits.title) ?? defTitle;
  const previewMessage = renderTemplate(message, sample, limits.message) ?? defMessage;

  const insert = (name) => {
    if (readOnly) return;
    const token = `{${name}}`;
    const isTitle = field === "title";
    const el = isTitle ? titleRef.current : messageRef.current;
    const value = isTitle ? title : message;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    (isTitle ? setTitle : setMessage)(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-primary/15 bg-primary/5 px-5 py-4 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2 text-lg font-bold text-primary">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <Bell className="h-4 w-4" />
            </span>
            {event.label}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {event.category}
            {event.description ? ` · ${event.description}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {!meta.templatesReady && (
            <div className="flex gap-2 rounded-lg bg-[#f5f0e6] px-3 py-2.5 text-sm text-[#5f4b1f]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Custom texts are not set up in the database yet. Ask your administrator to run{" "}
                <code className="rounded bg-background/70 px-1 text-xs">{meta.templateSqlFile}</code>.
                Until then the system&apos;s own wording is used.
              </span>
            </div>
          )}
          {meta.templatesReady && !meta.canEditTemplates && (
            <div className="flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" /> Only an administrator can change notification texts.
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Leave a box empty to keep the system&apos;s own wording. Click a placeholder to put it where the cursor is —
            it is filled in when the notification is sent.
          </p>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="tpl-title" className="text-[12.5px] font-semibold text-foreground/80">Title</label>
              <span className="text-xs tabular-nums text-muted-foreground">{title.length}/{limits.title}</span>
            </div>
            <Input
              id="tpl-title"
              ref={titleRef}
              value={title}
              maxLength={limits.title}
              disabled={readOnly}
              onFocus={() => setField("title")}
              onChange={(ev) => setTitle(ev.target.value)}
              placeholder={`System default — e.g. "${defTitle}"`}
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="tpl-message" className="text-[12.5px] font-semibold text-foreground/80">Message</label>
              <span className="text-xs tabular-nums text-muted-foreground">{message.length}/{limits.message}</span>
            </div>
            <Textarea
              id="tpl-message"
              ref={messageRef}
              value={message}
              rows={4}
              maxLength={limits.message}
              disabled={readOnly}
              onFocus={() => setField("message")}
              onChange={(ev) => setMessage(ev.target.value)}
              placeholder={`System default — e.g. "${defMessage}"`}
            />
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Placeholders · insert into {field === "title" ? "title" : "message"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {vars.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  disabled={readOnly}
                  onClick={() => insert(v.name)}
                  title={v.description}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-primary transition hover:border-primary/60 hover:bg-primary/5 disabled:opacity-50"
                >
                  {`{${v.name}}`}
                  <span className="hidden font-sans text-muted-foreground sm:inline">· {v.description}</span>
                </button>
              ))}
            </div>
            {unknown.length > 0 && (
              <div className="flex items-start gap-1.5 rounded-md bg-[#f5f0e6] px-2 py-1.5 text-xs text-[#5f4b1f]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {unknown.map((n) => `{${n}}`).join(", ")} {unknown.length === 1 ? "is" : "are"} not offered by this
                event and will be left empty.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-primary">Preview (sample values)</div>
            <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Bell className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold">{previewTitle}</div>
                <div className="break-words text-sm text-muted-foreground">{previewMessage}</div>
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The person who did it gets the same text; for them {"{title}"} and {"{message}"} are their own
              confirmation wording.
            </p>
          </div>
        </div>

        <SheetFooter className="flex-wrap gap-2 border-t border-border bg-muted/40 px-5 py-3 sm:space-x-0">
          <Button
            variant="ghost"
            className="gap-1.5 sm:mr-auto"
            disabled={readOnly || saving || !hasTemplate(event)}
            onClick={() => onSave(event.code, "", "", { reset: true })}
          >
            <RotateCcw className="h-4 w-4" /> Reset to default
          </Button>
          <Button variant="outline" className="bg-background" onClick={() => onOpenChange(false)}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button className="gap-1.5" disabled={!dirty || saving} onClick={() => onSave(event.code, title, message)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
