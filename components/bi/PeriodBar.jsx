"use client";
// components/bi/PeriodBar.jsx — the dashboard period bar: Today · Yesterday ·
// 7 days · This month · Last month · Year · 12 months · Pick dates.
// Pick dates opens a calendar (quick picks + From / To); the choice is one
// period string ("custom:2026-11-01:2026-11-12", lib/bi/periods.js).
// Phone: the chips scroll sideways; the calendar opens as a sheet.
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BAR_PERIODS, PERIOD_INFO, customPeriod, dayKey, parsePeriod, periodShort, MAX_CUSTOM_DAYS } from "@/lib/bi/periods";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sameDay = (a, b) => a && b && dayKey(a) === dayKey(b);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function quickPicks(today) {
  const d = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  const monday = d(-((today.getDay() + 6) % 7));
  return [
    ["Today", today, today],
    ["Yesterday", d(-1), d(-1)],
    ["Last 7 days", d(-6), today],
    ["This week", monday, today],
    ["Last week", new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7), new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1)],
    ["This month", new Date(today.getFullYear(), today.getMonth(), 1), today],
    ["Month to yesterday", new Date(today.getFullYear(), today.getMonth(), 1), d(-1)],
    ["Last month", new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)],
  ];
}

function RangePicker({ value, onApply, onCancel }) {
  const today = startOfDay(new Date());
  const current = parsePeriod(value);
  const [from, setFrom] = useState(current ? startOfDay(current.from) : today);
  const [to, setTo] = useState(current ? startOfDay(current.to) : today);
  const [picking, setPicking] = useState(false);
  const [month, setMonth] = useState(new Date((current?.to ?? today).getFullYear(), (current?.to ?? today).getMonth(), 1));

  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const days = Math.round((hi - lo) / 86400000) + 1;
  const tooLong = days > MAX_CUSTOM_DAYS;

  const cells = useMemo(() => {
    const lead = (month.getDay() + 6) % 7;
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  }, [month]);

  const pick = (d) => {
    if (d > today) return;
    if (!picking) {
      setFrom(d);
      setTo(d);
      setPicking(true);
    } else {
      setTo(d);
      setPicking(false);
    }
  };
  const fmt = (d) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const nextDisabled = new Date(month.getFullYear(), month.getMonth() + 1, 1) > today;

  return (
    <div className="bi-rp">
      <div className="bi-rp-quick" role="group" aria-label="Quick pick">
        <span className="bi-rp-label">Quick pick</span>
        {quickPicks(today).map(([label, a, b]) => (
          <button
            key={label}
            type="button"
            className={sameDay(a, lo) && sameDay(b, hi) ? "on" : ""}
            onClick={() => {
              setFrom(a);
              setTo(b);
              setPicking(false);
              setMonth(new Date(b.getFullYear(), b.getMonth(), 1));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="bi-rp-cal">
        <div className="bi-rp-inputs">
          <label>From<input readOnly value={fmt(lo)} className={picking ? "" : "on"} /></label>
          <label>To<input readOnly value={fmt(hi)} className={picking ? "on" : ""} /></label>
        </div>
        <div className="bi-rp-month">
          <button type="button" className="bi-btn bi-btn-icon" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronLeft size={16} />
          </button>
          <b>{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
          <button type="button" className="bi-btn bi-btn-icon" aria-label="Next month" disabled={nextDisabled} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="bi-rp-grid">
          {DOW.map((d) => <span key={d} className="dow">{d}</span>)}
          {cells.map((d, i) =>
            d ? (
              <button
                key={i}
                type="button"
                disabled={d > today}
                aria-label={d.toDateString()}
                aria-pressed={d >= lo && d <= hi}
                className={[
                  sameDay(d, lo) || sameDay(d, hi) ? "edge" : d > lo && d < hi ? "in" : "",
                  sameDay(d, today) ? "today" : "",
                ].join(" ")}
                onClick={() => pick(d)}
              >
                {d.getDate()}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
        <p className="bi-rp-hint">Click the first day, then the last. One day: click it twice. Future days can&apos;t be picked.</p>
        <div className="bi-rp-foot">
          <span className="num">{tooLong ? "At most 3 years" : `${days} day${days === 1 ? "" : "s"}`}</span>
          <div>
            <button type="button" className="bi-btn" onClick={onCancel}>Cancel</button>
            <button type="button" className="bi-btn bi-btn-primary" disabled={tooLong} onClick={() => onApply(customPeriod(lo, hi))}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PeriodBar({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const custom = String(value || "").startsWith("custom:");
  return (
    <div className="bi-period" role="tablist" aria-label="Period">
      {BAR_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={p === value}
          className={p === value ? "active" : ""}
          onClick={() => onChange(p)}
          title={PERIOD_INFO[p].key ? `${PERIOD_INFO[p].label} — key ${PERIOD_INFO[p].key.toUpperCase()}` : PERIOD_INFO[p].label}
        >
          {PERIOD_INFO[p].short}
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" role="tab" aria-selected={custom} className={custom ? "active" : ""}>
            <CalendarDays size={14} aria-hidden="true" />
            {custom ? periodShort(value) : "Pick dates"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="bi bi-rp-pop w-auto p-0">
          <RangePicker
            value={custom ? value : "yday"}
            onCancel={() => setOpen(false)}
            onApply={(v) => {
              onChange(v);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
