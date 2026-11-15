"use client";
// Chart of Accounts (/accounting/add-account).
//
// Four linked columns — Main Business → Business Category → Main Account →
// Accounts: pick one to see the next. Add / edit opens a side panel; an
// account's fields are grouped (contact, address, credit, tax, bank). The
// data and the API calls are the same as before (/api/accounts/<level>).
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import * as XLSX from "xlsx-js-style";
import ReactSelect from "react-select";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { IMPORT_LEVELS, matchHeaders } from "@/lib/accounts/importColumns";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Building,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit,
  FileSpreadsheet,
  FolderTree,
  Layers,
  Loader2,
  Plus,
  Power,
  Search,
  Upload,
  User,
  X,
} from "lucide-react";

const CONFIG = {
  levels: [
    { key: "mbscd", title: "Main Business", plural: "Main businesses", codeField: "mbscd", nameField: "mbscdDetail", parentField: null, icon: Building },
    { key: "bscd", title: "Business Category", plural: "Business categories", codeField: "bscd", nameField: "bscdDetail", parentField: "mbscd", icon: FolderTree },
    { key: "macno", title: "Main Account", plural: "Main accounts", codeField: "macno", nameField: "macname", parentField: "bscd", icon: Layers },
    { key: "acno", title: "Account", plural: "Accounts", codeField: "acno", nameField: "acname", parentField: "macno", icon: User },
  ],
  endpoints: {
    mbscd: "/api/accounts/mbscd",
    bscd: "/api/accounts/bscd",
    macno: "/api/accounts/macno",
    acno: "/api/accounts/acno",
  },
};
const levelOf = (key) => CONFIG.levels.find((l) => l.key === key);

// An account's fields, grouped for the side panel. `full` spans both columns.
const ACCOUNT_GROUPS = [
  {
    title: "Contact",
    fields: [
      { name: "contactPerson", label: "Contact person", uppercase: true },
      { name: "phoneFax", label: "Phone / fax" },
      { name: "email", label: "Email" },
      { name: "website", label: "Website" },
    ],
  },
  {
    title: "Address",
    fields: [
      { name: "address", label: "Address", uppercase: true, full: true },
      { name: "city", label: "City", uppercase: true },
      { name: "area", label: "Area", uppercase: true },
      { name: "areaCode", label: "Area code" },
      { name: "country", label: "Country", uppercase: true },
      { name: "salesArea", label: "Sales area" },
    ],
  },
  {
    title: "Credit",
    fields: [
      { name: "crDays", label: "Credit days", type: "number" },
      { name: "crDays2", label: "Credit days 2 (SIZ)", type: "number" },
      { name: "crLimit", label: "Credit limit", type: "number" },
    ],
  },
  {
    title: "Tax",
    fields: [
      { name: "stRate", label: "ST rate %", type: "number" },
      { name: "ntnNo", label: "NTN no" },
      { name: "stRegNo", label: "ST reg no" },
      { name: "stReg", label: "ST reg" },
      { name: "tax_filing_status", label: "Tax filing status" },
      { name: "tax_law_code", label: "Tax law code", type: "number" },
    ],
  },
  {
    title: "Bank & category",
    fields: [
      { name: "bankAccountNo", label: "Bank account no" },
      { name: "customerBank", label: "Customer bank", uppercase: true },
      { name: "customerBankAddr", label: "Customer bank address", uppercase: true, full: true },
      { name: "category", label: "Category", uppercase: true },
      { name: "subCategory", label: "Sub category", uppercase: true },
    ],
  },
];

const apiService = {
  fetchLevelData: async (levelKey, params = {}) => {
    const response = await axios.get(CONFIG.endpoints[levelKey], { params });
    return response.data.data || response.data;
  },
  createItem: async (levelKey, data) => (await axios.post(CONFIG.endpoints[levelKey], data)).data,
  updateItem: async (levelKey, code, data) =>
    (await axios.put(CONFIG.endpoints[levelKey], { ...data, [levelOf(levelKey).codeField]: code })).data,
  toggleActive: async (levelKey, code, isActive) =>
    (await axios.patch(CONFIG.endpoints[levelKey], { [levelOf(levelKey).codeField]: code, isActive })).data,
};

const errText = (error) => error?.response?.data?.error || error?.message || "Something went wrong";

// react-select in the system's maroon.
const selectStyles = (hasError) => ({
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderRadius: 8,
    borderColor: hasError ? "hsl(var(--destructive))" : state.isFocused ? "hsl(var(--primary))" : "hsl(var(--input))",
    boxShadow: state.isFocused ? "0 0 0 3px hsl(var(--primary) / 0.12)" : "none",
    "&:hover": { borderColor: hasError ? "hsl(var(--destructive))" : "hsl(var(--primary))" },
    fontSize: 14,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? "hsl(var(--primary))" : state.isFocused ? "hsl(var(--primary) / 0.07)" : "white",
    color: state.isSelected ? "white" : "hsl(var(--foreground))",
    cursor: "pointer",
    fontSize: 13.5,
  }),
  menu: (base) => ({ ...base, borderRadius: 8, overflow: "hidden", zIndex: 60 }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
});

function Kbd({ children, light = false }) {
  return (
    <kbd
      className={`hidden rounded border px-1 font-mono text-[10.5px] font-semibold sm:inline ${
        light ? "border-white/40 text-white/90" : "border-b-2 border-border bg-background text-muted-foreground"
      }`}
    >
      {children}
    </kbd>
  );
}

function Field({ field, value, error, onChange }) {
  return (
    <div className={field.full ? "sm:col-span-2" : ""}>
      <label htmlFor={`acc-${field.name}`} className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
        {field.label}
        {field.required && <span className="text-primary"> *</span>}
      </label>
      <Input
        id={`acc-${field.name}`}
        type={field.type === "number" ? "number" : "text"}
        value={value ?? ""}
        onChange={(e) => onChange(field.uppercase ? e.target.value.toUpperCase() : e.target.value)}
        className={`h-10 ${error ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
      />
      {error && <p className="mt-1 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

// ── Add / edit side panel ─────────────────────────────────────────────
function ItemPanel({ modalData, filters, saving, onClose, onCreate, onUpdate }) {
  const isEdit = modalData.mode === "edit";
  const level = modalData.level;
  const levelConfig = levelOf(level);
  const parentLevelConfig = levelOf(levelConfig?.parentField);

  const initial = () => {
    const base = { ...modalData.item };
    const parentField = levelConfig?.parentField;
    if (parentField && !base[parentField]) base[parentField] = filters[parentField] || "";
    return base;
  };
  const [formData, setFormData] = useState(initial);
  const [errors, setErrors] = useState({});
  const [parentOptions, setParentOptions] = useState([]);
  const [loadingParents, setLoadingParents] = useState(false);
  const nameRef = useRef(null);
  const searchTimer = useRef(null);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const set = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const loadParentOptions = async (searchValue = "") => {
    if (!parentLevelConfig) return;
    setLoadingParents(true);
    try {
      const params = {};
      // New: only under the level picked on the left. Edit: any parent (move it).
      if (!isEdit && parentLevelConfig.parentField && filters[parentLevelConfig.parentField]) {
        params[parentLevelConfig.parentField] = filters[parentLevelConfig.parentField];
      }
      if (searchValue) {
        params.search = searchValue;
        params.field = parentLevelConfig.nameField;
      }
      const items = await apiService.fetchLevelData(parentLevelConfig.key, params);
      setParentOptions(
        (items || []).map((item) => ({
          value: item[parentLevelConfig.codeField],
          label: `${item[parentLevelConfig.codeField]} - ${item[parentLevelConfig.nameField]}`,
        })),
      );
    } catch {
      setParentOptions([]);
    } finally {
      setLoadingParents(false);
    }
  };

  useEffect(() => {
    if (parentLevelConfig) loadParentOptions();
    setTimeout(() => nameRef.current?.focus(), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = () => {
    const e = {};
    const nameField = levelConfig.nameField;
    if (!String(formData[nameField] || "").trim()) e[nameField] = `${levelConfig.title} name is required`;
    if (parentLevelConfig && !formData[parentLevelConfig.codeField]) {
      e[parentLevelConfig.codeField] = `Pick a ${parentLevelConfig.title.toLowerCase()}`;
    }
    if (level === "acno") {
      if (formData.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = "Enter a full email address";
      if (
        formData.website?.trim() &&
        !/^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)$/.test(formData.website)
      ) {
        e.website = "Enter a website like www.company.com";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Same payload as before, per level.
  const payload = () => {
    const d = {};
    if (level === "mbscd") d.mbscdDetail = formData.mbscdDetail;
    else if (level === "bscd") {
      d.mbscd = parseInt(formData.mbscd);
      d.bscdDetail = formData.bscdDetail;
    } else if (level === "macno") {
      d.bscd = parseInt(formData.bscd);
      d.macname = formData.macname;
    } else if (level === "acno") {
      d.macno = parseInt(formData.macno);
      d.acname = formData.acname;
      const text = ["bankAccountNo", "address", "city", "phoneFax", "email", "website", "areaCode", "area", "category", "subCategory", "country", "customerBank", "customerBankAddr", "stRegNo", "stReg", "ntnNo", "contactPerson", "salesArea", "tax_filing_status"];
      for (const k of text) if (String(formData[k] ?? "").trim()) d[k] = formData[k];
      if (formData.crDays) d.crDays = parseInt(formData.crDays);
      if (formData.crDays2) d.crDays2 = parseInt(formData.crDays2);
      if (formData.stRate) d.stRate = parseFloat(formData.stRate);
      if (formData.crLimit) d.crLimit = parseInt(formData.crLimit);
      if (formData.tax_law_code) d.tax_law_code = parseInt(formData.tax_law_code);
      if (formData.lock !== undefined) d.lock = Boolean(formData.lock);
    }
    return d;
  };

  const submit = (again = false) => {
    if (saving || !validate()) return;
    if (isEdit) onUpdate({ level, code: modalData.item[levelConfig.codeField], data: payload() });
    else onCreate({ level, data: payload(), again, parent: parentLevelConfig ? formData[parentLevelConfig.codeField] : null });
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submit(false);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const nameField = levelConfig.nameField;
  const parentValue = parentLevelConfig ? formData[parentLevelConfig.codeField] : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-label={`${isEdit ? "Edit" : "New"} ${levelConfig.title}`} className="flex h-full w-full max-w-[600px] flex-col bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-primary/15 bg-primary/5 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-primary">
              {isEdit ? "Edit" : "New"} {levelConfig.title.toLowerCase()}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {isEdit
                ? `${modalData.item[levelConfig.codeField]} · ${modalData.item[nameField] || ""}`
                : "The code is given when you save"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Basic</p>
            <div>
              <label htmlFor="acc-name" className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                {levelConfig.title} name <span className="text-primary">*</span>
              </label>
              <Input
                id="acc-name"
                ref={nameRef}
                value={formData[nameField] ?? ""}
                onChange={(e) => set(nameField, level === "acno" ? e.target.value.toUpperCase() : e.target.value)}
                className={`h-10 ${errors[nameField] ? "border-destructive" : ""}`}
              />
              {errors[nameField] && <p className="mt-1 text-xs font-medium text-destructive">{errors[nameField]}</p>}
            </div>

            {parentLevelConfig && (
                <div>
                  <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                    {parentLevelConfig.title} <span className="text-primary">*</span>
                  </label>
                  <ReactSelect
                    inputId="acc-parent"
                    isClearable
                    isSearchable
                    isLoading={loadingParents}
                    options={parentOptions}
                    value={parentOptions.find((o) => o.value === parentValue) || (parentValue ? { value: parentValue, label: String(parentValue) } : null)}
                    onInputChange={(v, meta) => {
                      // Return nothing: react-select uses a returned value as the
                      // input text (a Promise there crashes the page).
                      if (meta.action !== "input-change") return;
                      clearTimeout(searchTimer.current);
                      searchTimer.current = setTimeout(() => loadParentOptions(v), 250);
                    }}
                    onChange={(opt) => set(parentLevelConfig.codeField, opt ? opt.value : "")}
                    placeholder={`Search ${parentLevelConfig.title.toLowerCase()}…`}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                    styles={selectStyles(!!errors[parentLevelConfig.codeField])}
                  />
                  {errors[parentLevelConfig.codeField] && (
                    <p className="mt-1 text-xs font-medium text-destructive">{errors[parentLevelConfig.codeField]}</p>
                  )}
                  {isEdit && parentValue && parentValue !== modalData.item[parentLevelConfig.codeField] && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Moves it from {parentLevelConfig.title.toLowerCase()} {modalData.item[parentLevelConfig.codeField]} — its past vouchers move with it in every report.
                    </p>
                  )}
                </div>
              )}
          </section>

          {level === "acno" &&
            ACCOUNT_GROUPS.map((g) => (
              <section key={g.title} className="space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{g.title}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {g.fields.map((f) => (
                    <Field key={f.name} field={f} value={formData[f.name]} error={errors[f.name]} onChange={(v) => set(f.name, v)} />
                  ))}
                </div>
              </section>
            ))}

          {level === "acno" && (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span>
                <span className="block text-sm font-semibold">Account locked</span>
                <span className="block text-xs text-muted-foreground">A locked account can't be used on new vouchers.</span>
              </span>
              <Switch checked={!!formData.lock} onCheckedChange={(v) => set("lock", v)} />
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <Button type="button" variant="outline" className="h-10 bg-background" onClick={onClose}>
            Cancel <Kbd>Esc</Kbd>
          </Button>
          {!isEdit && (
            <Button type="button" variant="outline" className="h-10 bg-background" onClick={() => submit(true)} disabled={saving}>
              Save &amp; add another
            </Button>
          )}
          <Button type="button" className="h-10 gap-2" onClick={() => submit(false)} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save" : "Create"} <Kbd light>Ctrl+S</Kbd>
          </Button>
        </div>
      </aside>
    </div>
  );
}

// ── Import from Excel ──────────────────────────────────────────────────
// Pick a level, fill the template, drop the file: it is read here, checked
// by the server (dry run — nothing saved) and shown row by row. "Import"
// saves every row in one go, only when no row has a problem
// (POST /api/accounts/import; columns in lib/accounts/importColumns.js).
const IMPORT_LEVEL_OPTIONS = ["acno", "macno"].map((k) => ({ value: k, label: IMPORT_LEVELS[k].title }));

function ImportDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [level, setLevel] = useState("acno");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]); // [{ row, ...fields }]
  const [results, setResults] = useState({}); // row → { ok, error }
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const def = IMPORT_LEVELS[level];

  const reset = () => {
    setFileName("");
    setRows([]);
    setResults({});
  };
  const close = () => {
    if (importing) return;
    reset();
    onClose();
  };

  const downloadTemplate = () => {
    const headers = def.columns.map((c) => c.header);
    const ws = XLSX.utils.aoa_to_sheet([headers, def.columns.map((c) => def.example[c.key] ?? "")]);
    ws["!cols"] = def.columns.map((c) => ({ wch: c.width || 16 }));
    const headerStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "800000" } },
      alignment: { horizontal: "center", vertical: "center" },
    };
    headers.forEach((_, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = headerStyle;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, def.sheet);
    XLSX.writeFile(wb, def.file);
  };

  // Server check of the rows; `real` saves them.
  const send = async (lvl, list, real = false) => {
    try {
      const res = await axios.post("/api/accounts/import", { level: lvl, rows: list, dryRun: !real });
      return res.data;
    } catch (e) {
      // A refused real run still carries the per-row results.
      if (e?.response?.data?.results) return e.response.data;
      throw e;
    }
  };

  const check = async (lvl, list) => {
    setChecking(true);
    try {
      const out = await send(lvl, list);
      setResults(Object.fromEntries(out.results.map((r) => [r.row, r])));
    } catch (e) {
      toast.error(`Could not check the file: ${errText(e)}`);
      setResults({});
    } finally {
      setChecking(false);
    }
  };

  const readFile = (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      toast.error("Choose an Excel (.xlsx, .xls) or CSV file");
      return;
    }
    const lvl = level;
    const reader = new FileReader();
    reader.onload = (e) => {
      let parsed;
      try {
        const wb = ext === "csv" ? XLSX.read(e.target.result, { type: "string" }) : XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        // raw: false — cells as shown in Excel (keeps long numbers, "17%").
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: true });
        // The sheet may not start at row 1; keep Excel's own row numbers.
        const firstRow = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r : 0;
        const headerAt = aoa.findIndex((r) => r.some((c) => String(c).trim()));
        if (headerAt < 0) {
          toast.error("The file is empty");
          return;
        }
        const map = matchHeaders(lvl, aoa[headerAt]);
        const missing = IMPORT_LEVELS[lvl].columns.filter((c) => c.required && !Object.values(map).includes(c.key));
        if (missing.length) {
          toast.error(`Columns missing: ${missing.map((c) => c.header).join(", ")} — use the template`);
          return;
        }
        parsed = [];
        aoa.slice(headerAt + 1).forEach((r, i) => {
          if (!r.some((c) => String(c).trim())) return;
          const item = { row: firstRow + headerAt + i + 2 }; // the row number in Excel
          for (const [idx, key] of Object.entries(map)) item[key] = r[idx];
          parsed.push(item);
        });
      } catch {
        toast.error("Could not read the file — check its format");
        return;
      }
      if (!parsed.length) {
        toast.error("The file has headers but no rows");
        return;
      }
      setFileName(file.name);
      setRows(parsed);
      setResults({});
      check(lvl, parsed);
    };
    if (ext === "csv") reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  };

  const onFile = (event) => {
    readFile(event.target.files?.[0]);
    event.target.value = "";
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    readFile(e.dataTransfer.files?.[0]);
  };

  const checked = rows.length > 0 && Object.keys(results).length > 0;
  const bad = rows.filter((r) => results[r.row] && !results[r.row].ok).length;
  const ready = rows.filter((r) => results[r.row]?.ok).length;
  const canImport = checked && bad === 0 && ready === rows.length && !checking && !importing;

  const runImport = async () => {
    if (!canImport) return;
    setImporting(true);
    try {
      const out = await send(level, rows, true);
      setResults(Object.fromEntries(out.results.map((r) => [r.row, r])));
      if (!out.created) {
        toast.error("Nothing was imported — fix the rows marked in red");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: [level] });
      toast.success(`${out.created} ${out.created === 1 ? "account" : "accounts"} imported`);
      reset();
      onClose();
    } catch (e) {
      toast.error(`Could not import: ${errText(e)}`);
    } finally {
      setImporting(false);
    }
  };

  // Preview: parent, name and (for accounts) a couple of contact fields.
  const previewCols = [def.parentKey, def.nameKey, ...(level === "acno" ? ["city", "phoneFax"] : [])].map((k) =>
    def.columns.find((c) => c.key === k),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-4xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-primary">Import chart of accounts</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label htmlFor="import-level" className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                What to import
              </label>
              <ReactSelect
                inputId="import-level"
                isSearchable={false}
                options={IMPORT_LEVEL_OPTIONS}
                value={IMPORT_LEVEL_OPTIONS.find((o) => o.value === level)}
                onChange={(opt) => {
                  setLevel(opt.value);
                  reset();
                }}
                isDisabled={checking || importing}
                menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                styles={selectStyles(false)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {level === "acno"
                  ? "Accounts under existing main accounts — give the main account's code."
                  : "Main accounts under existing business categories — give the category's code."}{" "}
                Codes are given on import.
              </p>
            </div>
            <Button variant="outline" onClick={downloadTemplate} className="h-10 gap-2 bg-background">
              <Download className="h-4 w-4" />
              Download the template
            </Button>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            disabled={checking || importing}
            className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed ${
              dragOver ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <FileSpreadsheet className="h-9 w-9 text-primary/70" />
            <span className="text-sm font-semibold">Drop the file here or choose one</span>
            <span className="text-xs text-muted-foreground">.xlsx, .xls or .csv · first sheet · headers as in the template</span>
            {fileName && <span className="max-w-full truncate text-xs font-medium text-primary">{fileName}</span>}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

          {rows.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-3 py-2 text-xs">
                <span className="font-bold text-primary">
                  {rows.length} {rows.length === 1 ? "row" : "rows"}
                </span>
                {checking ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
                  </span>
                ) : (
                  checked && (
                    <>
                      <span className="rounded-full bg-[#edf2ee] px-2 py-0.5 font-semibold text-[#2f5139]">{ready} ready</span>
                      {bad > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-800">{bad} with problems</span>}
                    </>
                  )
                )}
              </div>
              <div className="max-h-[45vh] overflow-auto">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-primary text-primary-foreground">
                      <th className="px-3 py-2 font-semibold">Row</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      {previewCols.map((c) => (
                        <th key={c.key} className="px-3 py-2 font-semibold">
                          {c.header}
                        </th>
                      ))}
                      <th className="px-3 py-2 font-semibold">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const res = results[r.row];
                      return (
                        <tr key={r.row} className={`border-b border-border last:border-0 ${res && !res.ok ? "bg-red-50/40" : ""}`}>
                          <td className="px-3 py-1.5 font-mono text-[12px] tabular-nums text-muted-foreground">{r.row}</td>
                          <td className="px-3 py-1.5">
                            {!res ? (
                              <span className="text-muted-foreground">—</span>
                            ) : res.ok ? (
                              <span className="rounded-full bg-[#edf2ee] px-2 py-0.5 text-[11.5px] font-semibold text-[#2f5139]">
                                {res.code ? `Code ${res.code}` : "OK"}
                              </span>
                            ) : (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-semibold text-red-800">Fix</span>
                            )}
                          </td>
                          {previewCols.map((c) => (
                            <td key={c.key} className="max-w-[220px] truncate px-3 py-1.5">
                              {String(r[c.key] ?? "")}
                            </td>
                          ))}
                          <td className="min-w-[200px] px-3 py-1.5 text-xs text-red-800">{res && !res.ok ? res.error : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:gap-2">
          <Button variant="outline" onClick={close} disabled={importing}>
            Close
          </Button>
          <Button onClick={runImport} disabled={!canImport} className="gap-2">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import {rows.length || ""} {rows.length === 1 ? "account" : "accounts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── One column of the chart ────────────────────────────────────────────
function LevelColumn({
  levelConfig,
  index,
  items,
  loading,
  parentPicked,
  selected,
  search,
  onSearch,
  onPick,
  onAdd,
  onEdit,
  canManageVisibility,
  onToggleActive,
  searchRef,
  className = "",
}) {
  const Icon = levelConfig.icon;
  const parent = levelOf(levelConfig.parentField);
  const isLast = index === CONFIG.levels.length - 1;
  const term = (search || "").trim().toLowerCase();
  const shown = term
    ? items.filter((it) => `${it[levelConfig.codeField]} ${it[levelConfig.nameField] || ""} ${it.city || ""}`.toLowerCase().includes(term))
    : items;

  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background ${className}`}>
      <div className="flex items-center gap-2.5 border-b border-primary/15 bg-primary/5 px-3 py-2.5">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-primary">{levelConfig.plural}</p>
          <p className="text-[11px] text-muted-foreground">
            {parentPicked ? `${items.length} ${items.length === 1 ? "item" : "items"}` : `Pick a ${parent?.title.toLowerCase()} first`}
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          title={`New ${levelConfig.title.toLowerCase()}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-border p-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border px-2.5 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <Search className="h-4 w-4 flex-shrink-0" />
          <input
            ref={searchRef}
            value={search || ""}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onSearch("")}
            placeholder={`Search ${levelConfig.plural.toLowerCase()}…`}
            aria-label={`Search ${levelConfig.plural}`}
            disabled={!parentPicked}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none disabled:cursor-not-allowed"
          />
        </label>
      </div>

      <div className="min-h-[180px] flex-1 overflow-y-auto p-1.5">
        {!parentPicked ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            Pick a {parent?.title.toLowerCase()} on the left to see its {levelConfig.plural.toLowerCase()}.
          </p>
        ) : loading ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : shown.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{term ? "Nothing matches." : `No ${levelConfig.plural.toLowerCase()} yet.`}</p>
            {!term && (
              <Button variant="outline" size="sm" className="mt-3 h-8 gap-1.5" onClick={onAdd}>
                <Plus className="h-3.5 w-3.5" /> Add one
              </Button>
            )}
          </div>
        ) : (
          shown.map((item) => {
            const code = item[levelConfig.codeField];
            const isSel = selected === code;
            const isOff = item.isActive === false;
            return (
              <div
                key={code}
                className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                  isSel ? "bg-primary text-primary-foreground" : "hover:bg-primary/[0.05]"
                } ${isOff ? "opacity-60" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => (isLast ? onEdit(item) : onPick(code))}
                  className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left outline-none focus-visible:underline"
                >
                  <span
                    className={`flex-shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[11.5px] font-bold tabular-nums ${
                      isSel ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{item[levelConfig.nameField]}</span>
                    {isLast && (item.city || item.phoneFax || item.email) && (
                      <span className={`block truncate text-[11.5px] ${isSel ? "text-white/80" : "text-muted-foreground"}`}>
                        {[item.city, item.phoneFax || item.email].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  {isOff && (
                    <span className={`flex-shrink-0 rounded-full px-1.5 text-[10.5px] font-semibold ${isSel ? "bg-white/20" : "bg-muted text-muted-foreground"}`}>
                      Off
                    </span>
                  )}
                </button>
                <div className={`flex flex-shrink-0 items-center ${isSel ? "" : "lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"}`}>
                  {canManageVisibility && (levelConfig.key === "macno" || levelConfig.key === "acno") && (
                    <button
                      type="button"
                      title={isOff ? "Turn on" : "Turn off"}
                      onClick={() => onToggleActive(code, isOff)}
                      className={`flex h-7 w-7 items-center justify-center rounded ${isSel ? "hover:bg-white/15" : "text-primary/70 hover:bg-primary/10 hover:text-primary"}`}
                    >
                      <Power className={`h-3.5 w-3.5 ${isOff ? "opacity-50" : ""}`} />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Edit"
                    onClick={() => onEdit(item)}
                    className={`flex h-7 w-7 items-center justify-center rounded ${isSel ? "hover:bg-white/15" : "text-primary/70 hover:bg-primary/10 hover:text-primary"}`}
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                  {!isLast && <ChevronRight className={`h-4 w-4 ${isSel ? "" : "text-muted-foreground/60"}`} />}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
const ChartOfAccounts = () => {
  const queryClient = useQueryClient();
  const { data: authSession } = useSession();
  // Anyone who has menu access to this page can turn accounts on/off.
  const canManageVisibility = !!authSession?.user;

  const [filters, setFilters] = useState({ mbscd: null, bscd: null, macno: null });
  const [searchTerms, setSearchTerms] = useState({});
  const [panel, setPanel] = useState(null); // { mode, level, item, nonce }
  const [importOpen, setImportOpen] = useState(false);
  const accountSearchRef = useRef(null);

  // "Show off accounts" is one shared, saved switch (Settings key
  // show_off_accounts) — it only changes what this page lists; voucher
  // pickers always hide off accounts.
  const { data: visibilitySetting } = useQuery({
    queryKey: ["account-visibility-setting"],
    queryFn: async () => (await axios.get("/api/settings/account-visibility")).data.data,
  });
  const showInactive = visibilitySetting?.showOffAccounts ?? false;
  const includeInactive = canManageVisibility && showInactive;

  const toggleShowInactive = useMutation({
    mutationFn: (next) => axios.put("/api/settings/account-visibility", { showOffAccounts: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account-visibility-setting"] }),
    onError: (e) => toast.error(`Could not change the setting: ${errText(e)}`),
  });

  const mbscdQ = useQuery({ queryKey: ["mbscd"], queryFn: () => apiService.fetchLevelData("mbscd") });
  const bscdQ = useQuery({
    queryKey: ["bscd", filters.mbscd],
    queryFn: () => apiService.fetchLevelData("bscd", { mbscd: filters.mbscd }),
    enabled: !!filters.mbscd,
  });
  const macnoQ = useQuery({
    queryKey: ["macno", filters.bscd, includeInactive],
    queryFn: () => apiService.fetchLevelData("macno", { bscd: filters.bscd, ...(includeInactive ? { includeInactive: true } : {}) }),
    enabled: !!filters.bscd,
  });
  const acnoQ = useQuery({
    queryKey: ["acno", filters.macno, includeInactive],
    queryFn: () => apiService.fetchLevelData("acno", { macno: filters.macno, ...(includeInactive ? { includeInactive: true } : {}) }),
    enabled: !!filters.macno,
  });
  const queries = { mbscd: mbscdQ, bscd: bscdQ, macno: macnoQ, acno: acnoQ };
  const data = useMemo(
    () => ({
      mbscd: mbscdQ.data || [],
      bscd: bscdQ.data || [],
      macno: macnoQ.data || [],
      acno: acnoQ.data || [],
    }),
    [mbscdQ.data, bscdQ.data, macnoQ.data, acnoQ.data],
  );

  const createMutation = useMutation({
    mutationFn: ({ level, data: body }) => apiService.createItem(level, body),
    onSuccess: async (_, { level, again, parent }) => {
      await queryClient.invalidateQueries({ queryKey: [level] });
      toast.success(`${levelOf(level).title} created`);
      const parentField = levelOf(level).parentField;
      if (again) setPanel({ mode: "create", level, item: parentField ? { [parentField]: parent } : {}, nonce: Date.now() });
      else setPanel(null);
    },
    onError: (e) => toast.error(`Could not create: ${errText(e)}`),
  });
  const updateMutation = useMutation({
    mutationFn: ({ level, code, data: body }) => apiService.updateItem(level, code, body),
    onSuccess: async (_, { level }) => {
      await queryClient.invalidateQueries({ queryKey: [level] });
      toast.success("Saved");
      setPanel(null);
    },
    onError: (e) => toast.error(`Could not save: ${errText(e)}`),
  });
  const toggleActiveMutation = useMutation({
    mutationFn: ({ level, code, isActive }) => apiService.toggleActive(level, code, isActive),
    onSuccess: (_, { level, isActive }) => {
      queryClient.invalidateQueries({ queryKey: [level] });
      // Turning a main account off / on changes which accounts show too.
      if (level === "macno") queryClient.invalidateQueries({ queryKey: ["acno"] });
      toast.success(isActive ? "Turned on" : "Turned off");
    },
    onError: (e) => toast.error(`Could not change it: ${errText(e)}`),
  });

  const pick = (levelKey, value) =>
    setFilters((prev) => {
      const next = { ...prev };
      const i = CONFIG.levels.findIndex((l) => l.key === levelKey);
      CONFIG.levels.slice(i + 1).forEach((l) => (next[l.key] = null));
      next[levelKey] = value;
      return next;
    });
  // Back to a level: clears it and everything under it.
  const clearFrom = (levelKey) =>
    setFilters((prev) => {
      const next = { ...prev };
      const i = CONFIG.levels.findIndex((l) => l.key === levelKey);
      CONFIG.levels.slice(i).forEach((l) => (next[l.key] = null));
      return next;
    });

  const openForm = (mode, level, item = {}) => setPanel({ mode, level, item, nonce: Date.now() });
  const openNewAccount = () => openForm("create", "acno", { macno: filters.macno || "" });

  useEffect(() => {
    const onKey = (e) => {
      if (panel || importOpen) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // "/" focuses the search (Ctrl+K is the header's menu search).
        e.preventDefault();
        accountSearchRef.current?.focus();
      } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        openNewAccount();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The path picked so far, for the breadcrumb.
  const path = CONFIG.levels
    .filter((l) => l.key !== "acno" && filters[l.key])
    .map((l) => {
      const item = data[l.key].find((x) => x[l.codeField] === filters[l.key]);
      return { level: l, code: filters[l.key], name: item?.[l.nameField] || filters[l.key] };
    });
  // On a phone one column shows at a time: the next one to pick from.
  const phoneCol = Math.min(path.length, CONFIG.levels.length - 1);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <FolderTree className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">Accounting · Setup</p>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Chart of Accounts</h1>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {canManageVisibility && (
              <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium">
                <Switch
                  checked={showInactive}
                  disabled={toggleShowInactive.isPending}
                  onCheckedChange={(v) => toggleShowInactive.mutate(v)}
                  aria-label="Show off accounts"
                />
                Show off accounts
              </label>
            )}
            <Button variant="outline" className="h-10 gap-2 bg-background" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button className="h-10 flex-1 gap-2 sm:flex-none" onClick={openNewAccount}>
              <Plus className="h-4 w-4" />
              New account <Kbd light>N</Kbd>
            </Button>
          </div>
        </div>

        {/* Path */}
        <nav aria-label="Selected path" className="mb-3 flex min-h-[40px] flex-wrap items-center gap-1 rounded-xl border border-border bg-background px-3 py-1.5 text-sm">
          {path.length > 0 && (
            <button
              type="button"
              onClick={() => clearFrom(path[path.length - 1].level.key)}
              className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10 lg:hidden"
              aria-label="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => clearFrom("mbscd")} className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10">
            All
          </button>
          {path.map((p) => (
            <span key={p.level.key} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                type="button"
                onClick={() => pick(p.level.key, p.code)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-primary/10"
                title={p.level.title}
              >
                <span className="rounded bg-primary/10 px-1 font-mono text-[11px] font-bold text-primary">{p.code}</span>
                <span className="font-medium">{p.name}</span>
              </button>
            </span>
          ))}
          {path.length === 0 && <span className="text-muted-foreground">Pick a main business to start</span>}
        </nav>

        {/* Columns */}
        <div className="grid gap-3 lg:h-[calc(100vh-235px)] lg:min-h-[480px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
          {CONFIG.levels.map((l, i) => {
            const parentPicked = !l.parentField || !!filters[l.parentField];
            return (
              <LevelColumn
                key={l.key}
                className={i === phoneCol ? "" : "max-lg:hidden"}
                levelConfig={l}
                index={i}
                items={data[l.key]}
                loading={queries[l.key].isLoading}
                parentPicked={parentPicked}
                selected={l.key === "acno" ? null : filters[l.key]}
                search={searchTerms[l.key]}
                onSearch={(v) => setSearchTerms((prev) => ({ ...prev, [l.key]: v }))}
                onPick={(code) => pick(l.key, code)}
                onAdd={() => openForm("create", l.key, l.parentField && filters[l.parentField] ? { [l.parentField]: filters[l.parentField] } : {})}
                onEdit={(item) => openForm("edit", l.key, item)}
                canManageVisibility={canManageVisibility}
                onToggleActive={(code, turnOn) => toggleActiveMutation.mutate({ level: l.key, code, isActive: turnOn })}
                searchRef={l.key === "acno" ? accountSearchRef : undefined}
              />
            );
          })}
        </div>
      </div>

      {panel && (
        <ItemPanel
          key={panel.nonce}
          modalData={panel}
          filters={filters}
          saving={createMutation.isPending || updateMutation.isPending}
          onClose={() => setPanel(null)}
          onCreate={(args) => createMutation.mutate(args)}
          onUpdate={(args) => updateMutation.mutate(args)}
        />
      )}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
};

export default ChartOfAccounts;
