// components/ui/searchable-select.jsx
"use client";
import React, { forwardRef, useId, useMemo } from "react";
import Select from "react-select";

/**
 * react-select styling built on the app's theme tokens, so it reads correctly
 * in both light and dark mode and matches the maroon primary.
 *
 * Contrast notes: borders use --input (not gray-300), placeholder uses
 * --muted-foreground, and the focused option sits on a 12% primary tint —
 * all well above the washed-out grays this replaces.
 */
export const searchableSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "40px",
    fontSize: "14px",
    borderRadius: "8px",
    borderWidth: "1.5px",
    backgroundColor: state.isDisabled
      ? "hsl(var(--muted))"
      : "hsl(var(--background))",
    borderColor: state.isFocused
      ? "hsl(var(--primary))"
      : "hsl(var(--input))",
    boxShadow: state.isFocused
      ? "0 0 0 3px hsl(var(--primary) / 0.18)"
      : "none",
    opacity: state.isDisabled ? 0.6 : 1,
    transition: "border-color 120ms ease, box-shadow 120ms ease",
    "&:hover": {
      borderColor: state.isFocused
        ? "hsl(var(--primary))"
        : "hsl(var(--primary) / 0.5)",
    },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 10px" }),
  input: (base) => ({ ...base, color: "hsl(var(--foreground))", margin: 0 }),
  singleValue: (base) => ({
    ...base,
    fontSize: "14px",
    color: "hsl(var(--foreground))",
  }),
  placeholder: (base) => ({
    ...base,
    fontSize: "14px",
    color: "hsl(var(--muted-foreground))",
  }),
  menu: (base) => ({
    ...base,
    zIndex: 60,
    borderRadius: "10px",
    overflow: "hidden",
    backgroundColor: "hsl(var(--background))",
    border: "1.5px solid hsl(var(--border))",
    boxShadow: "0 12px 32px -8px rgb(0 0 0 / 0.25)",
  }),
  menuList: (base) => ({ ...base, maxHeight: "280px", padding: "4px" }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  option: (base, state) => ({
    ...base,
    fontSize: "14px",
    padding: "8px 10px",
    borderRadius: "6px",
    cursor: "pointer",
    backgroundColor: state.isSelected
      ? "hsl(var(--primary))"
      : state.isFocused
        ? "hsl(var(--primary) / 0.12)"
        : "transparent",
    color: state.isSelected
      ? "hsl(var(--primary-foreground))"
      : "hsl(var(--foreground))",
    "&:active": { backgroundColor: "hsl(var(--primary) / 0.2)" },
  }),
  noOptionsMessage: (base) => ({
    ...base,
    fontSize: "13px",
    color: "hsl(var(--muted-foreground))",
  }),
  indicatorSeparator: (base) => ({
    ...base,
    backgroundColor: "hsl(var(--border))",
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    padding: "6px",
    color: state.isFocused
      ? "hsl(var(--primary))"
      : "hsl(var(--muted-foreground))",
    "&:hover": { color: "hsl(var(--primary))" },
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: "6px",
    color: "hsl(var(--muted-foreground))",
    "&:hover": { color: "hsl(var(--destructive))" },
  }),
};

const portalTarget = () =>
  typeof document !== "undefined" ? document.body : null;

/**
 * A type-to-search dropdown that takes and returns plain scalar values, so it
 * is a drop-in replacement for a native/shadcn <Select> that had none.
 *
 * Options may be `{ value, label }` or raw rows plus `getValue`/`getLabel`.
 */
const SearchableSelect = forwardRef(function SearchableSelect(
  {
    value,
    onChange,
    options = [],
    placeholder = "Select…",
    isDisabled = false,
    isClearable = true,
    inputId,
    instanceId,
    ariaLabel,
    emptyMessage = "No matches",
    ...rest
  },
  ref,
) {
  // react-select numbers its aria ids from a module-level counter, which runs
  // at a different rate on the server than on the client (StrictMode renders
  // each instance twice), producing a hydration mismatch. A stable instanceId
  // makes those ids deterministic. useId is SSR-safe; strip its punctuation so
  // the resulting id stays selector-friendly.
  const reactId = useId();
  const stableInstanceId =
    instanceId ?? inputId ?? reactId.replace(/[^a-zA-Z0-9_-]/g, "");

  // Compare loosely: form state often holds "3" while options hold 3
  const selected = useMemo(() => {
    if (value === null || value === undefined || value === "") return null;
    return options.find((o) => String(o.value) === String(value)) ?? null;
  }, [options, value]);

  return (
    <Select
      ref={ref}
      value={selected}
      onChange={(opt) => onChange(opt ? opt.value : null, opt)}
      options={options}
      styles={searchableSelectStyles}
      isSearchable
      isClearable={isClearable}
      openMenuOnFocus
      isDisabled={isDisabled}
      placeholder={placeholder}
      inputId={inputId}
      instanceId={stableInstanceId}
      aria-label={ariaLabel || placeholder}
      classNamePrefix="rs"
      menuPortalTarget={portalTarget()}
      menuPlacement="auto"
      noOptionsMessage={() => emptyMessage}
      {...rest}
    />
  );
});

export default SearchableSelect;
