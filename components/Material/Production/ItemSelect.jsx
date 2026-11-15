// components/Material/Production/ItemSelect.jsx
"use client";
import React, { forwardRef, useCallback, useId, useRef } from "react";
import AsyncSelect from "react-select/async";
import axios from "axios";

/**
 * Shared react-select styles so every dropdown in the Production module
 * looks identical and stays readable in light + dark mode.
 */
export const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "34px",
    fontSize: "12px",
    borderRadius: "8px",
    backgroundColor: "hsl(var(--background))",
    borderWidth: "1px",
    borderColor: state.isFocused
      ? "hsl(var(--primary))"
      : "hsl(var(--input))",
    boxShadow: state.isFocused ? "0 0 0 2px hsl(var(--primary) / 0.2)" : "none",
    "&:hover": { borderColor: state.isFocused ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.5)" },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 6px" }),
  input: (base) => ({ ...base, color: "hsl(var(--foreground))", margin: 0 }),
  singleValue: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
  placeholder: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
  menu: (base) => ({
    ...base,
    fontSize: "12px",
    zIndex: 9999,
    backgroundColor: "hsl(var(--background))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    overflow: "hidden",
  }),
  menuList: (base) => ({ ...base, maxHeight: "260px" }),
  option: (base, state) => ({
    ...base,
    cursor: "pointer",
    backgroundColor: state.isSelected
      ? "hsl(var(--primary))"
      : state.isFocused
        ? "hsl(var(--primary) / 0.12)"
        : "transparent",
    color: state.isSelected
      ? "hsl(var(--primary-foreground))"
      : "hsl(var(--foreground))",
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  indicatorsContainer: (base) => ({ ...base, height: "32px" }),
  dropdownIndicator: (base) => ({ ...base, padding: "4px" }),
  clearIndicator: (base) => ({ ...base, padding: "4px" }),
};

/** Portal target that is safe during SSR. */
export const portalTarget = () =>
  typeof document !== "undefined" ? document.body : null;

/**
 * Debounces an async loader so typing a code does not fire a request per keystroke.
 * Only the most recent call resolves with data; superseded calls resolve to [].
 */
export const useDebouncedLoader = (loader, wait = 250) => {
  const timerRef = useRef(null);
  const seqRef = useRef(0);

  return useCallback(
    (inputValue) =>
      new Promise((resolve) => {
        const mySeq = ++seqRef.current;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          try {
            const result = await loader(inputValue);
            resolve(mySeq === seqRef.current ? result : []);
          } catch (error) {
            console.error("Option load failed:", error);
            resolve([]);
          }
        }, wait);
      }),
    [loader, wait],
  );
};

/** Normalises an API item row into a select option that carries its code. */
export const toItemOption = (i) => ({
  value: i.itcd,
  code: i.code || "",
  name: i.item || "",
  unit: i.unit || "",
  // label is what react-select matches against for keyboard type-ahead
  label: `${i.code ? `${i.code} ` : ""}${i.itcd} ${i.item || ""}`.trim(),
  raw: i,
});

/**
 * Renders an option as: [CODE]  Item name          itcd · unit
 * In the closed control it collapses to a single compact line.
 */
export const formatItemOption = (option, { context }) => {
  if (!option) return null;
  const code = option.code;
  const name = option.name || option.label;

  if (context === "value") {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        {code && (
          <span className="flex-shrink-0 font-mono font-semibold text-primary">
            {code}
          </span>
        )}
        <span className="truncate">{name}</span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="flex-shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
        {code || "—"}
      </span>
      <span className="flex-1 truncate font-medium">{name}</span>
      <span className="flex-shrink-0 text-[10px] text-muted-foreground font-mono">
        #{option.value}
        {option.unit ? ` · ${option.unit}` : ""}
      </span>
    </div>
  );
};

/**
 * Item picker searchable by CODE, item name, or item id (itcd).
 * The backing API (/api/forms/items) already matches all three — this component
 * surfaces the code so the user can see and confirm what they typed.
 */
const ItemSelect = forwardRef(function ItemSelect(
  {
    value,
    onChange,
    category,
    limit = 20,
    placeholder = "Search by code, name or ID…",
    isDisabled = false,
    autoFocus = false,
    minWidth = "240px",
    ariaLabel = "Search item by code",
    instanceId,
    ...rest
  },
  ref,
) {
  // Stable aria ids so server and client markup agree (see searchable-select).
  const reactId = useId();
  const stableInstanceId =
    instanceId ?? reactId.replace(/[^a-zA-Z0-9_-]/g, "");

  const fetchItems = useCallback(
    async (inputValue) => {
      const params = { search: inputValue || "", limit };
      if (category) params.category = category;
      const response = await axios.get("/api/forms/items", { params });
      return (response.data.items || []).map(toItemOption);
    },
    [category, limit],
  );

  const loadOptions = useDebouncedLoader(fetchItems, 250);

  return (
    <AsyncSelect
      ref={ref}
      cacheOptions
      defaultOptions
      value={value}
      onChange={onChange}
      loadOptions={loadOptions}
      formatOptionLabel={formatItemOption}
      instanceId={stableInstanceId}
      isSearchable
      isClearable
      openMenuOnFocus
      autoFocus={autoFocus}
      isDisabled={isDisabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      classNamePrefix="react-select"
      menuPortalTarget={portalTarget()}
      menuPlacement="auto"
      noOptionsMessage={({ inputValue }) =>
        inputValue ? `No item matches "${inputValue}"` : "Type a code to search"
      }
      loadingMessage={() => "Searching…"}
      styles={{
        ...selectStyles,
        control: (base, state) => ({
          ...selectStyles.control(base, state),
          minWidth,
        }),
      }}
      {...rest}
    />
  );
});

export default ItemSelect;
