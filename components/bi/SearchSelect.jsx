"use client";
// components/bi/SearchSelect.jsx — the dashboard's dropdowns: type to search,
// one or many values, clear with one click. Built on react-select with the
// app's theme tokens (components/ui/searchable-select.jsx), sized for the
// BI toolbar. The menu is portalled so it is never clipped by a card.
import { useId, useMemo } from "react";
import Select from "react-select";
import { searchableSelectStyles as base } from "@/components/ui/searchable-select";

const styles = {
  ...base,
  control: (b, s) => ({
    ...base.control(b, s),
    minHeight: 36,
    fontSize: 13,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: s.hasValue ? "hsl(var(--primary) / 0.06)" : "hsl(var(--card))",
    borderColor: s.isFocused ? "hsl(var(--primary))" : s.hasValue ? "hsl(var(--primary) / 0.45)" : "hsl(var(--border))",
  }),
  valueContainer: (b) => ({ ...b, padding: "0 8px", gap: 4 }),
  singleValue: (b) => ({ ...b, fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))" }),
  placeholder: (b) => ({ ...b, fontSize: 13, color: "hsl(var(--muted-foreground))" }),
  option: (b, s) => ({ ...base.option(b, s), fontSize: 13, padding: "7px 10px" }),
  multiValue: (b) => ({ ...b, borderRadius: 6, backgroundColor: "hsl(var(--primary) / 0.12)" }),
  multiValueLabel: (b) => ({ ...b, fontSize: 12, fontWeight: 500, color: "hsl(var(--primary))", padding: "2px 6px" }),
  multiValueRemove: (b) => ({
    ...b,
    borderRadius: 6,
    color: "hsl(var(--primary))",
    ":hover": { backgroundColor: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" },
  }),
  menu: (b) => ({ ...base.menu(b), minWidth: 240 }),
  menuPortal: (b) => ({ ...b, zIndex: 9999 }),
  groupHeading: (b) => ({ ...b, fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: "hsl(var(--muted-foreground))" }),
};

/**
 * value: a scalar (single) or an array of scalars (multi).
 * options: [{ value, label }] or plain strings.
 */
export default function SearchSelect({
  value,
  onChange,
  options = [],
  multi = false,
  placeholder = "All",
  width = 220,
  isClearable = true,
  ariaLabel,
  formatOptionLabel,
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const opts = useMemo(
    () => options.map((o) => (typeof o === "object" && o !== null ? o : { value: o, label: String(o) })),
    [options],
  );
  const selected = useMemo(() => {
    if (multi) {
      const vals = (Array.isArray(value) ? value : []).map(String);
      return opts.filter((o) => vals.includes(String(o.value)));
    }
    return value === null || value === undefined || value === "" ? null : opts.find((o) => String(o.value) === String(value)) ?? null;
  }, [opts, value, multi]);

  return (
    <div style={{ width, maxWidth: "100%" }}>
      <Select
        instanceId={id}
        inputId={`${id}-input`}
        aria-label={ariaLabel || placeholder}
        options={opts}
        value={selected}
        isMulti={multi}
        isClearable={isClearable}
        isSearchable
        closeMenuOnSelect={!multi}
        hideSelectedOptions={false}
        placeholder={placeholder}
        noOptionsMessage={() => "No matches"}
        styles={styles}
        menuPortalTarget={typeof document !== "undefined" ? document.body : null}
        menuPosition="fixed"
        formatOptionLabel={formatOptionLabel}
        onChange={(v) => onChange(multi ? (v || []).map((x) => x.value) : v?.value ?? "")}
      />
    </div>
  );
}
