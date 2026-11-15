"use client";

import * as React from "react";
import { CalendarIcon, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDMY, parseDMY, toDate, toISODate } from "@/lib/date-format";

/**
 * Day-first date input.
 *
 * Replaces `<Input type="date">`, whose displayed order is dictated by the
 * browser locale (mm/dd/yyyy on a US-locale machine) and cannot be forced.
 * This one always reads and writes DD-MM-YYYY on screen, while `value` /
 * `onChange` stay on the ISO `yyyy-MM-dd` the APIs expect — so callers keep
 * the same contract they had with the native input.
 *
 * Typing is forgiving: digits are enough (03092026), separators are inserted
 * as you go, and the text only becomes a value once it parses to a real date,
 * so a half-typed "03-09-20" never fires a bogus onChange. On blur an
 * unparseable string snaps back to the last good value.
 *
 * Props:
 *   value     - "yyyy-MM-dd" | "" 
 *   onChange  - (iso: "yyyy-MM-dd" | "") => void
 *   clearable - show an inline clear button when a date is set
 */
export function DateField({
  value,
  onChange,
  id,
  disabled = false,
  clearable = false,
  placeholder = "DD-MM-YYYY",
  className,
  inputClassName,
  align = "start",
  ...props
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => formatDMY(value, ""));

  // Follow the value when it changes from outside (dialog opening on an
  // existing row, filters being reset, …) but never fight the user mid-typing.
  React.useEffect(() => {
    setText(formatDMY(value, ""));
  }, [value]);

  const selected = toDate(value) ?? undefined;

  const handleType = (raw) => {
    // Keep digits only, then lay the dashes back in at 2 / 4 digits.
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let next = digits;
    if (digits.length > 4) {
      next = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
    } else if (digits.length > 2) {
      next = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    }
    setText(next);

    if (!digits.length) {
      if (value) onChange("");
      return;
    }
    const iso = parseDMY(next);
    if (iso && iso !== value) onChange(iso);
  };

  const handleBlur = () => {
    if (!text.trim()) {
      if (value) onChange("");
      return;
    }
    const iso = parseDMY(text);
    if (iso) {
      onChange(iso);
      setText(formatDMY(iso, ""));
    } else {
      setText(formatDMY(value, "")); // snap back to the last good value
    }
  };

  return (
    <div className={cn("relative flex items-center", className)}>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => handleType(e.target.value)}
        onBlur={handleBlur}
        className={cn("pr-16 tabular-nums", inputClassName)}
        {...props}
      />

      <div className="absolute right-1 flex items-center gap-0.5">
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            onClick={() => {
              onChange("");
              setText("");
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label="Open calendar"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align={align}>
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(d) => {
                onChange(d ? toISODate(d) : "");
                setOpen(false);
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export default DateField;
