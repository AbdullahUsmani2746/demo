"use client";
// The add / edit side panel of every setup screen (AddModal / EditModal are
// thin wrappers). Fields come from components/Setups/config.js:
//   text · email · number · date · checkbox (a switch) · select (react-select,
//   options from `options` or loaded from `fetchFrom`).
// Behaviour kept from the old pop-ups: uppercase fields, `dependsOn` resets the
// dependent field, a manager's name fills from the picked employee, bank fields
// hide when the payment method is CASH, a checkbox unset counts as its
// `defaultValue`. Ctrl+S saves, Esc closes.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import ReactSelect from "react-select";
import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const BANK_FIELDS = ["bankId", "bankBranchId", "accountName", "accountNumber"];

export const selectStyles = (hasError) => ({
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderRadius: 8,
    fontSize: 14,
    borderColor: hasError ? "hsl(var(--destructive))" : state.isFocused ? "hsl(var(--primary))" : "hsl(var(--input))",
    boxShadow: state.isFocused ? "0 0 0 3px hsl(var(--primary) / 0.12)" : "none",
    "&:hover": { borderColor: hasError ? "hsl(var(--destructive))" : "hsl(var(--primary))" },
  }),
  option: (base, state) => ({
    ...base,
    fontSize: 13.5,
    cursor: "pointer",
    backgroundColor: state.isSelected ? "hsl(var(--primary))" : state.isFocused ? "hsl(var(--primary) / 0.07)" : "transparent",
    color: state.isSelected ? "white" : "hsl(var(--foreground))",
  }),
  placeholder: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
  menu: (base) => ({ ...base, borderRadius: 8, overflow: "hidden", backgroundColor: "hsl(var(--popover))" }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
});

const errText = (error) =>
  error?.response?.data?.error || error?.response?.data?.message || error?.message || "Could not save";

const labelOf = (field, item) =>
  typeof field.optionLabelKey === "function" ? field.optionLabelKey(item) : item?.[field.optionLabelKey];

export default function EntityFormPanel({
  mode = "add", // add | edit
  title,
  fields = [],
  initialData,
  onSubmit, // (formData, { again }) => Promise
  onClose,
  onDelete, // edit only, optional
  isSubmitting: externalSubmitting = false,
}) {
  const isEdit = mode === "edit";
  const [formData, setFormData] = useState(() => (isEdit ? { ...(initialData || {}) } : {}));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || externalSubmitting;
  const firstRef = useRef(null);

  useEffect(() => {
    if (isEdit) setFormData({ ...(initialData || {}) });
  }, [isEdit, initialData]);

  // Option lists for selects that load their own.
  const fetchFields = fields.filter((f) => f.fieldType === "select" && f.fetchFrom && !Array.isArray(f.options));
  const { data: relationData, isLoading: loadingOptions } = useQuery({
    queryKey: ["modalRelatedData", title, fetchFields.map((f) => f.fetchFrom).join("-")],
    queryFn: async () => {
      const out = {};
      await Promise.all(
        fetchFields.map(async (f) => {
          try {
            const res = await axios.get(f.fetchFrom);
            out[f.name] = res.data.data || res.data;
          } catch {
            out[f.name] = [];
          }
        }),
      );
      return out;
    },
    enabled: fetchFields.length > 0,
  });

  const optionsOf = (field) => {
    if (Array.isArray(field.options)) return field.options;
    return (relationData?.[field.name] || []).map((item) => ({ value: item[field.optionValueKey], label: labelOf(field, item) }));
  };

  const visible = (field) => !(BANK_FIELDS.includes(field.name) && formData.paymentMethod === "CASH");
  const shown = fields.filter(visible);

  const setValue = (field, raw) => {
    let value = raw;
    if ((field.uppercase || field.upppercase) && typeof value === "string") value = value.toUpperCase();
    setErrors((e) => (e[field.name] ? { ...e, [field.name]: "" } : e));
    setSubmitError(null);
    setFormData((prev) => {
      const next = { ...prev, [field.name]: value };
      // A field that depends on this one starts again.
      for (const dep of fields) {
        if (dep.dependsOn && dep.dependsOn.includes(field.name)) {
          next[dep.name] = "";
          if (dep.name === "employeeId" && /manager/i.test(title)) next.manager = "";
        }
      }
      // Managers: the name comes from the picked employee.
      if (field.name === "employeeId" && /manager/i.test(title) && value) {
        const emp = (relationData?.employeeId || []).find((e) => String(e.id) === String(value));
        if (emp) next.manager = [emp.firstName, emp.middleName, emp.surname].filter(Boolean).join(" ");
      }
      return next;
    });
  };

  const validate = () => {
    const e = {};
    for (const f of shown) {
      const v = formData[f.name];
      const empty = v === undefined || v === null || v === "";
      if (f.required && f.fieldType !== "checkbox" && empty) e[f.name] = `${f.label} is required`;
      if (f.fieldType === "number" && !empty && isNaN(Number(v))) e[f.name] = `${f.label} must be a number`;
      if (f.fieldType === "email" && !empty && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) e[f.name] = "Enter a full email address";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (again = false) => {
    if (busy) return;
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // A switch the user never touched is saved as it is shown (its default).
      const payload = { ...formData };
      for (const f of fields) {
        if (f.fieldType === "checkbox" && payload[f.name] === undefined && f.defaultValue !== undefined) payload[f.name] = f.defaultValue;
      }
      await onSubmit(payload, { again });
      if (again) {
        setFormData({});
        setErrors({});
        setTimeout(() => firstRef.current?.focus(), 30);
      }
    } catch (err) {
      setSubmitError(errText(err));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => firstRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submit(false);
      } else if (e.key === "Escape" && !document.querySelector("[role=alertdialog]")) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const twoCols = shown.length > 4;
  const portal = typeof document !== "undefined" ? document.body : null;
  let firstAssigned = false;
  const refFor = (field) => {
    if (firstAssigned || field.fieldType === "checkbox" || field.fieldType === "select") return undefined;
    firstAssigned = true;
    return firstRef;
  };

  const renderInput = (field) => {
    const err = errors[field.name];
    const id = `ef-${field.name}`;
    const value = formData[field.name];
    if (field.fieldType === "checkbox") {
      const checked = value ?? field.defaultValue ?? false;
      return (
        <label htmlFor={id} className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <span className="text-sm text-foreground/90">{field.checkboxLabel || (checked ? field.trueLabel : field.falseLabel) || field.label}</span>
          <Switch id={id} checked={!!checked} onCheckedChange={(v) => setValue(field, v)} />
        </label>
      );
    }
    if (field.fieldType === "select") {
      const options = optionsOf(field);
      const selected = options.find((o) => String(o.value) === String(value ?? "")) || null;
      return (
        <ReactSelect
          inputId={id}
          options={options}
          value={selected}
          onChange={(opt) => setValue(field, opt ? opt.value : "")}
          isClearable={!field.required}
          isLoading={loadingOptions && !Array.isArray(field.options)}
          placeholder={`Select ${String(field.label || "").toLowerCase()}…`}
          noOptionsMessage={() => "Nothing found"}
          menuPortalTarget={portal}
          menuPlacement="auto"
          styles={selectStyles(!!err)}
        />
      );
    }
    const readOnly = field.name === "manager" && /manager/i.test(title);
    return (
      <Input
        id={id}
        ref={refFor(field)}
        type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : field.fieldType === "email" ? "email" : "text"}
        step={field.fieldType === "number" ? "0.01" : undefined}
        value={field.fieldType === "date" ? String(value ?? "").slice(0, 10) : value ?? ""}
        onChange={(e) => setValue(field, e.target.value)}
        readOnly={readOnly}
        className={`h-10 ${readOnly ? "bg-muted/60 text-muted-foreground" : ""} ${err ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
      />
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside role="dialog" aria-label={title} className="flex h-full w-full max-w-[560px] flex-col bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-primary/15 bg-primary/5 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-primary">{title}</h2>
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? `ID ${initialData?.id ?? initialData?.ccno ?? initialData?.parameter_name ?? ""}`
                : "Fields marked * are required"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <div className={`grid flex-1 content-start gap-4 overflow-y-auto px-5 py-4 ${twoCols ? "sm:grid-cols-2" : ""}`}>
            {shown.map((field) => (
              <div key={field.name} className={field.fieldType === "checkbox" && twoCols ? "sm:col-span-2" : ""}>
                <label htmlFor={`ef-${field.name}`} className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                  {field.label}
                  {field.required && <span className="text-primary"> *</span>}
                </label>
                {renderInput(field)}
                {errors[field.name] && <p className="mt-1 text-xs font-medium text-destructive">{errors[field.name]}</p>}
              </div>
            ))}
            {submitError && (
              <p className={`rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive ${twoCols ? "sm:col-span-2" : ""}`}>{submitError}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-5 py-3">
            {isEdit && onDelete ? (
              <Button type="button" variant="ghost" className="h-10 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete} disabled={busy}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-10 bg-background" onClick={onClose} disabled={busy}>
                Cancel
                <kbd className="ml-1.5 hidden rounded border border-b-2 border-border px-1 font-mono text-[10.5px] text-muted-foreground sm:inline">Esc</kbd>
              </Button>
              {!isEdit && (
                <Button type="button" variant="outline" className="h-10 bg-background" onClick={() => submit(true)} disabled={busy}>
                  Save &amp; add another
                </Button>
              )}
              <Button type="submit" className="h-10 gap-2" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
                <kbd className="hidden rounded border border-white/40 px-1 font-mono text-[10.5px] text-white/90 sm:inline">Ctrl+S</kbd>
              </Button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}
