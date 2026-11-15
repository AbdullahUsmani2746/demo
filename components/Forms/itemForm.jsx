"use client";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import SearchableSelect from "@/components/ui/searchable-select";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import KeyboardHint, { KeyCombo } from "@/components/ui/KeyboardHint";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import {
  fetchItem,
  createItem,
  updateItem,
  fetchSubtrates,
  fetchCategories,
  fetchItemQuality,
  fetchQualityParameters,
  fetchPackingMaterials,
  saveItemQuality,
} from "@/lib/api";
import {
  Save,
  X,
  Plus,
  Trash2,
  ChevronDown,
  CheckCircle2,
  Copy,
  AlertTriangle,
  ArrowLeft,
  Package,
  Tag,
  Boxes,
  Palette,
  CalendarRange,
  ShieldCheck,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useProductionSetup } from "@/hooks/useProductionSetup";
import { useFeatures } from "@/hooks/useFeatures";
import { isFinishedCategory, isPackingCategory } from "@/lib/production/setupConfig";

const fetchDropdownData = async (endpoint) => {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Failed to fetch ${endpoint}`);
  const res = await response.json();
  return res.data ?? res;
};

// ── Item Save Success Dialog ─────────────────────────────────────────────
const ItemSaveSuccessDialog = ({ result, onClose }) => {
  if (!result) return null;
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="item-save-success-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.85, opacity: 0, y: 30 }}
          animate={{ scale: 1,    opacity: 1, y: 0  }}
          exit={{    scale: 0.85, opacity: 0, y: 30 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Maroon header */}
          <div className="bg-primary px-6 py-5 text-primary-foreground text-center">
            <div className="flex justify-center mb-3">
              <div className="bg-white/20 rounded-full p-3">
                <CheckCircle2 className="h-8 w-8 text-white" />
              </div>
            </div>
            <h2 className="text-lg font-bold">
              {result.isUpdate ? "Item Updated" : "Item Created"}
            </h2>
            <p className="text-primary-foreground/80 text-sm mt-0.5">Material Master</p>
          </div>

          {/* ITCD display */}
          <div className="px-6 py-5 space-y-3">
            <div className="flex items-center justify-between bg-muted/60 border border-border rounded-xl px-4 py-4">
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Item Code (ITCD)</p>
                <p className="text-2xl font-bold text-foreground font-mono mt-0.5">{result.itcd}</p>
              </div>
              <button
                onClick={() => { navigator.clipboard?.writeText(String(result.itcd)); }}
                className="bg-muted hover:bg-muted-foreground/20 rounded-lg p-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Copy ITCD"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {result.itemName && (
              <div className="bg-muted/60 border border-border rounded-xl px-4 py-3">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Item Name</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{result.itemName}</p>
              </div>
            )}
            {result.code && (
              <div className="bg-muted/60 border border-border rounded-xl px-4 py-3">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Ink Code</p>
                <p className="text-sm font-mono font-semibold text-foreground mt-0.5">{result.code}</p>
              </div>
            )}
          </div>

          <div className="px-6 pb-5">
            <button
              onClick={onClose}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl py-2.5 transition-colors"
            >
              OK
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

// Returns today as YYYY-MM-DD
const todayStr = () => new Date().toISOString().split("T")[0];

// Returns valid_to: same day & month but year 9999
const validToStr = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `9999-${mm}-${dd}`;
};

// ── Layout pieces (module level: never re-created on a keystroke) ─────────
const Section = ({ icon: Icon, title, subtitle, children, actions }) => (
  <section className="overflow-hidden rounded-xl border border-border bg-background">
    <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
      {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-primary">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
    <div className="p-4 sm:p-5">{children}</div>
  </section>
);

const Field = ({ label, required, children, hint, htmlFor, wide }) => (
  <div className={`flex min-w-0 flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
    <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-foreground/80">
      {label}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
    {children}
    {hint && <span className="text-[11.5px] text-muted-foreground">{hint}</span>}
  </div>
);

const GRID = "grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3";

// Shared input classes: visible border, maroon focus ring.
const inputCls =
  "h-10 rounded-lg border border-input bg-background text-sm text-foreground " +
  "placeholder:text-muted-foreground transition-colors " +
  "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15";

const SummaryRow = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 py-2 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="min-w-0 text-right font-medium text-foreground">{children}</span>
  </div>
);

export default function ItemForm() {
  const router = useRouter();
  const params = useParams();
  const id = params.id;
  const queryClient = useQueryClient();
  const firstFieldRef = useRef(null);
  const formRef = useRef(null);

  const [formData, setFormData] = useState({
    item: "",
    ic_id: "",
    mc_id: "",
    pc_id: "",
    customer_code: "",
    ltr_rate: "",
    re_order: "",
    minimum_order_quantity: "",
    grn_direct_rate: false,
    is_Card: false,
    alternate_id: "",
    unit: "KG",
    subtrates: null,
    valid_from: todayStr(),
    valid_to: validToStr(),
    viscosity: "",
    color_bulk: "",
    gloss: "",
    opacity: "",
    fineness: "",
    solid: "",
    adhesion: "",
    e: "",
    a: "",
    l: "",
    b: "",
    packing_material_code: "",
    code: "",
    ink_type: null,
    lamination: null,
    color: null,
    wastage_percentage: "",
    import_type: null,
    business_unit: null,
    nature_of_ink: null,
    printing_property: null,
    with_white: 0,
  });


  const [newParam, setNewParam] = useState("");
  const [newValue, setNewValue] = useState("");
  const [qualityMatrixData, setQualityMatrixData] = useState([]);
  const [tempQualityData, setTempQualityData] = useState([]);
  const [showQuality, setShowQuality] = useState(false);
  const [saveResult, setSaveResult] = useState(null);  // success dialog data
  const [codeCheck, setCodeCheck] = useState({ checking: false, exists: false, itcd: null, item: null }); // ink code duplication checker

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 5 * 60 * 1000 });
  // Suggest the next Master Sample no when Semi‑finished category selected.
  // The field is editable for every category, so other categories leave
  // whatever the user typed alone.
  useEffect(() => {
    if (id) return; // only in create mode
    const selectedCat = categories.find((c) => String(c.id) === String(formData.ic_id));
    const isSemiFinished = selectedCat && /semi[-\s]?finished/i.test(selectedCat.ic_name);
    if (!isSemiFinished) return;
    const isCard = formData.is_Card;
    fetch(`/api/reports/masterSample/latest?is_Card=${isCard}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.latestSampleNo) {
          setFormData((prev) => ({ ...prev, alternate_id: data.latestSampleNo }));
        }
      })
      .catch(() => {});
  }, [formData.ic_id, formData.is_Card, categories, id]);
  const { data: subtrates = [] } = useQuery({ queryKey: ["subtrates"], queryFn: fetchSubtrates, staleTime: 5 * 60 * 1000 });
  const { data: packingMaterials = [] } = useQuery({ queryKey: ["packingMaterials"], queryFn: fetchPackingMaterials, staleTime: 5 * 60 * 1000 });
  const { data: qualityParams = [] } = useQuery({ queryKey: ["qualityParameters"], queryFn: fetchQualityParameters, staleTime: 5 * 60 * 1000 });
  const { data: inkTypes = [] } = useQuery({ queryKey: ["inkTypes"], queryFn: () => fetchDropdownData("/api/setup/ink_types"), staleTime: 5 * 60 * 1000 });
  const { data: srLaminations = [] } = useQuery({ queryKey: ["srLaminations"], queryFn: () => fetchDropdownData("/api/setup/sr_laminations"), staleTime: 5 * 60 * 1000 });
  const { data: colorCodes = [] } = useQuery({ queryKey: ["colorCodes"], queryFn: () => fetchDropdownData("/api/setup/color_codes"), staleTime: 5 * 60 * 1000 });
  const { data: businessUnits = [] } = useQuery({ queryKey: ["businessUnits"], queryFn: () => fetchDropdownData("/api/setup/business_units"), staleTime: 5 * 60 * 1000 });
  const { data: natureOfInks = [] } = useQuery({ queryKey: ["natureOfInks"], queryFn: () => fetchDropdownData("/api/setup/nature_of_inks"), staleTime: 5 * 60 * 1000 });
  const { data: printingProperties = [] } = useQuery({ queryKey: ["printingProperties"], queryFn: () => fetchDropdownData("/api/setup/printing_properties"), staleTime: 5 * 60 * 1000 });
  const { data: mainCategories = [] } = useQuery({ queryKey: ["mainCategories"], queryFn: () => fetchDropdownData("/api/setup/item_main_categories"), staleTime: 5 * 60 * 1000 });
  const { data: subCategories = [] } = useQuery({ queryKey: ["itemSubCategories"], queryFn: () => fetchDropdownData("/api/setup/item_sub_categories"), staleTime: 5 * 60 * 1000 });
  const { data: customers = [] } = useQuery({
    queryKey: ["customersDropdown"],
    queryFn: async () => {
      const response = await fetch("/api/forms/customers?limit=1000");
      if (!response.ok) throw new Error("Failed to fetch customers");
      const res = await response.json();
      return res.customers ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: itemData, isLoading: itemLoading } = useQuery({
    queryKey: ["item", id],
    queryFn: () => fetchItem(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });

  const { data: qualityData } = useQuery({
    queryKey: ["itemQuality", id],
    queryFn: () => fetchItemQuality(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (qualityData && id) {
      setQualityMatrixData(qualityData.map((item) => ({ ...item, isDirty: false })));
    } else if (!id) {
      setQualityMatrixData(tempQualityData);
    }
  }, [qualityData, id]);

  useEffect(() => {
    if (itemData && id) {
      setFormData(prev => {
        const newData = {
          ...itemData,
          description: itemData.description || "",
          e: itemData.e || "",
          a: itemData.a || "",
          l: itemData.l || "",
          b: itemData.b || "",
          ic_id: itemData.ic_id ? String(itemData.ic_id) : "",
          mc_id: itemData.mc_id ? String(itemData.mc_id) : "",
          pc_id: itemData.pc_id ? String(itemData.pc_id) : "",
          customer_code: itemData.customer_code ? String(itemData.customer_code) : "",
          ltr_rate: itemData.ltr_rate !== null && itemData.ltr_rate !== undefined ? itemData.ltr_rate : "",
          re_order: itemData.re_order !== null && itemData.re_order !== undefined ? itemData.re_order : "",
          minimum_order_quantity: itemData.minimum_order_quantity ?? "",
          grn_direct_rate: itemData.grn_direct_rate === true,
          fineness: itemData.fineness || "",
          gloss: itemData.gloss || "",
          color_bulk: itemData.color_bulk || "",
          opacity: itemData.opacity || "",
          viscosity: itemData.viscosity || "",
          adhesion: itemData.adhesion || "",
          alternate_id: itemData.alternate_id ? String(itemData.alternate_id) : "",
          code: itemData.code || "",
          packing_material_code: itemData.packing_material_code ? String(itemData.packing_material_code) : "",
          valid_from: itemData.valid_from ? new Date(itemData.valid_from).toISOString().split("T")[0] : todayStr(),
          valid_to: itemData.valid_to ? new Date(itemData.valid_to).toISOString().split("T")[0] : validToStr(),
          color: itemData.color || null,
          ink_type: itemData.ink_type || null,
          lamination: itemData.lamination || null,
          wastage_percentage: itemData.wastage_percentage !== null ? itemData.wastage_percentage : "",
          import_type: itemData.import_type || null,
          business_unit: itemData.business_unit || null,
          nature_of_ink: itemData.nature_of_ink || null,
          printing_property: itemData.printing_property || null,
          with_white: itemData.with_white ?? 0,
          is_Card: itemData.is_Card ?? false,
        };
        
        return newData;
      });
    }
  }, [itemData, id]);

  // Focus first field on mount
  useEffect(() => {
    if (firstFieldRef.current) firstFieldRef.current.focus();
  }, []);

  // Settings → Production setup: finished goods carry a packing material
  const { setup } = useProductionSetup();
  const features = useFeatures();
  const isPackingMaterialEnabled = React.useMemo(() => isFinishedCategory(setup, formData.ic_id), [formData.ic_id, setup]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    
    setFormData((prev) => ({ ...prev, [name]: value }));
  }
    

  // Ink code duplication checker — debounced check against existing items
  useEffect(() => {
    const code = formData.code?.trim();
    if (!code) { setCodeCheck({ checking: false, exists: false, itcd: null, item: null }); return; }
    setCodeCheck((prev) => ({ ...prev, checking: true }));
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ code });
      if (id) params.set("exclude", id);
      fetch(`/api/forms/items/check-code?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => setCodeCheck({ checking: false, exists: !!d.exists, itcd: d.itcd ?? null, item: d.item ?? null }))
        .catch(() => setCodeCheck({ checking: false, exists: false, itcd: null, item: null }));
    }, 400);
    return () => clearTimeout(timer);
  }, [formData.code, id]);

  // Enter moves to the next field. Scoped to the form (it used to scan the
  // whole document, so it could jump into the nav), and it leaves react-select
  // alone because Enter there picks the highlighted option.
  const handleKeyDown = (e) => {
    if (e.key !== "Enter") return;
    if (e.target.tagName === "TEXTAREA") return;
    if (e.target.type === "submit") return;
    // react-select renders its search box inside .rs__control
    if (e.target.closest?.(".rs__control")) return;

    e.preventDefault();
    const form = formRef.current;
    if (!form) return;

    const focusable = Array.from(
      form.querySelectorAll(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);

    const idx = focusable.indexOf(document.activeElement);
    if (idx > -1 && focusable[idx + 1]) {
      const next = focusable[idx + 1];
      next.focus();
      next.select?.();
    }
  };

  const handleQualityMatrixChange = (index, field, value) => {
    const updatedData = id ? [...qualityMatrixData] : [...tempQualityData];
    updatedData[index] = { ...updatedData[index], [field]: value, isDirty: true };
    if (id) {
      setQualityMatrixData(updatedData);
    } else {
      setTempQualityData(updatedData);
      setQualityMatrixData(updatedData);
    }
  };

  const handleAddParameter = () => {
    if (!newParam || !newValue) { toast.error("Select a parameter and enter a value"); return; }
    const currentData = id ? qualityMatrixData : tempQualityData;
    if (currentData.some((item) => item.parameter_name === newParam)) { toast.error("Parameter already exists"); return; }
    const newParameter = { parameter_name: newParam, quality_standard: newValue, isDirty: true };
    if (id) {
      setQualityMatrixData([...qualityMatrixData, newParameter]);
    } else {
      const updatedTemp = [...tempQualityData, newParameter];
      setTempQualityData(updatedTemp);
      setQualityMatrixData(updatedTemp);
    }
    setNewParam("");
    setNewValue("");
    toast.success("Parameter added");
  };

  const handleRemoveParameter = (parameterName) => {
    if (id) {
      setQualityMatrixData(qualityMatrixData.filter((item) => item.parameter_name !== parameterName));
    } else {
      const updatedTemp = tempQualityData.filter((item) => item.parameter_name !== parameterName);
      setTempQualityData(updatedTemp);
      setQualityMatrixData(updatedTemp);
    }
    toast.success("Parameter removed");
  };

  const saveQualityMatrixMutation = useMutation({
    mutationFn: () => saveItemQuality(id, qualityMatrixData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["itemQuality", id] });
      setQualityMatrixData(qualityMatrixData.map((item) => ({ ...item, isDirty: false })));
      toast.success("Quality matrix saved!");
    },
    onError: () => toast.error("Failed to save quality matrix"),
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const formattedData = {
        ...data,
        ic_id: data.ic_id ? parseInt(data.ic_id) : undefined,
        mc_id: data.mc_id ? parseInt(data.mc_id) : null,
        pc_id: data.pc_id ? parseInt(data.pc_id) : null,
        customer_code: data.customer_code ? parseInt(data.customer_code) : null,
        ltr_rate: data.ltr_rate !== "" && data.ltr_rate !== null && data.ltr_rate !== undefined ? parseFloat(data.ltr_rate) : null,
        re_order: data.re_order !== "" && data.re_order !== null && data.re_order !== undefined ? parseInt(data.re_order) : null,
        minimum_order_quantity:
          data.minimum_order_quantity !== "" && data.minimum_order_quantity != null ? parseFloat(data.minimum_order_quantity) : null,
        // Settings → Features "grn.directRateByItem": while off the tick is not sent (the stored one is kept)
        grn_direct_rate: features.on("grn.directRateByItem") ? data.grn_direct_rate === true : undefined,
        alternate_id: data.alternate_id && String(data.alternate_id).trim() ? parseInt(String(data.alternate_id)) : null,
        packing_material_code: data.packing_material_code ? parseInt(data.packing_material_code) : undefined,
        valid_from: data.valid_from ? new Date(data.valid_from).toISOString() : null,
        valid_to: data.valid_to ? new Date(data.valid_to).toISOString() : null,
        wastage_percentage: data.wastage_percentage ? parseFloat(data.wastage_percentage) : null,
      };
      if (id) return updateItem(id, formattedData);
      const createdItem = await createItem(formattedData);
      if (tempQualityData.length > 0) await saveItemQuality(createdItem.itcd, tempQualityData);
      return createdItem;
    },
    onSuccess: (savedItem) => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      if (id) {
        queryClient.invalidateQueries({ queryKey: ["item", id] });
        queryClient.invalidateQueries({ queryKey: ["itemQuality", id] });
      }
      setSaveResult({
        itcd:     savedItem.itcd     || id,
        itemName: savedItem.item     || formData.item,
        code:     savedItem.code     || formData.code || null,
        isUpdate: !!id,
      });
    },
    onError: (err) => toast.error(err?.response?.data?.error || "Failed to save item. Please try again."),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (codeCheck.exists) {
      toast.error(`Ink code "${formData.code}" is already used by "${codeCheck.item}" (itcd ${codeCheck.itcd}).`);
      return;
    }
    saveMutation.mutate(formData);
  };

  const availableParameters = qualityParams.filter(
    (param) => !qualityMatrixData.some((matrixItem) => matrixItem.parameter_name === param.parameter_name)
  );

  const hasUnsavedQualityChanges = id && qualityMatrixData.some((item) => item.isDirty);

  // ── Select options ──────────────────────────────────────────────────────
  // Memoised: these used to be rebuilt on every keystroke, which re-rendered
  // every dropdown in the form.
  const substratesOptions = useMemo(
    () => subtrates.map((sub) => ({ value: sub.subtrate, label: sub.subtrate })),
    [subtrates],
  );
  const inkTypesOptions = useMemo(
    () => inkTypes.map((ink) => ({ value: ink.ink_type, label: ink.ink_type })),
    [inkTypes],
  );
  const srLaminationsOptions = useMemo(
    () => [
      { value: "PET", label: "PET" },
      { value: "MPET", label: "MPET" },
      { value: "PE", label: "PE" },
      ...srLaminations.map((sr) => ({
        value: sr.sr_lamination,
        label: sr.sr_lamination,
      })),
    ],
    [srLaminations],
  );
  const colorCodesOptions = useMemo(
    () => colorCodes.map((c) => ({ value: c.color_code, label: c.color_code })),
    [colorCodes],
  );
  const businessUnitsOptions = useMemo(
    () => businessUnits.map((bu) => ({ value: bu.business_unit, label: bu.business_unit })),
    [businessUnits],
  );
  const natureOfInksOptions = useMemo(
    () => natureOfInks.map((n) => ({ value: n.nature_of_ink, label: n.nature_of_ink })),
    [natureOfInks],
  );
  const printingPropertiesOptions = useMemo(
    () => printingProperties.map((pp) => ({ value: pp.printing_property, label: pp.printing_property })),
    [printingProperties],
  );

  // Previously plain shadcn <Select>s with no search box at all.
  // Every category the person may add items to (Admin → Permissions → Data
  // scope → Item categories; all of them when not limited). The category an
  // item already has stays listed so an existing item still shows it.
  const { data: manageable } = useQuery({
    queryKey: ["itemManageCategories"],
    queryFn: async () => (await fetch("/api/forms/items/categories")).json(),
    staleTime: 5 * 60 * 1000,
  });
  const categoryOptions = useMemo(() => {
    const list = manageable?.categories ?? categories;
    const opts = list.map((cat) => ({ value: String(cat.id), label: cat.ic_name }));
    const current = formData.ic_id ? String(formData.ic_id) : "";
    if (current && !opts.some((o) => o.value === current)) {
      const cat = categories.find((c) => String(c.id) === current);
      if (cat) opts.push({ value: current, label: cat.ic_name });
    }
    return opts;
  }, [manageable, categories, formData.ic_id]);
  const mainCategoryOptions = useMemo(
    () => mainCategories.map((mc) => ({ value: String(mc.id), label: mc.mc_name })),
    [mainCategories],
  );
  const subCategoryOptions = useMemo(
    () => subCategories.map((pc) => ({ value: String(pc.id), label: pc.pc_name })),
    [subCategories],
  );
  // The worst offender: up to 1000 customers in a dropdown you had to scroll.
  const customerOptions = useMemo(
    () =>
      customers.map((cust) => ({
        value: String(cust.acno),
        label: `${cust.acname} (${cust.acno})`,
      })),
    [customers],
  );
  const packingMaterialOptions = useMemo(
    () =>
      packingMaterials
        .filter((material) => isPackingCategory(setup, material.ic_id))
        .map((material) => ({
          value: String(material.itcd),
          label: material.item,
        })),
    [packingMaterials, setup],
  );
  const importTypeOptions = useMemo(
    () => [
      { value: "LOCAL", label: "Local" },
      { value: "IMPORTED", label: "Imported" },
    ],
    [],
  );
  const itemTypeOptions = useMemo(
    () => [
      { value: "master_sample", label: "Sample" },
      { value: "qc_card", label: "QC Card" },
    ],
    [],
  );
  const availableParameterOptions = useMemo(
    () =>
      availableParameters.map((param) => ({
        value: param.parameter_name,
        label: param.parameter_name,
      })),
    [availableParameters],
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  const submitFromKeyboard = useCallback(() => {
    if (saveMutation.isPending || codeCheck.exists) return;
    document.activeElement?.blur?.();
    formRef.current?.requestSubmit?.();
  }, [saveMutation.isPending, codeCheck.exists]);

  useKeyboardShortcuts({
    "ctrl+s": { handler: submitFromKeyboard, allowInInput: true },
    "alt+q": {
      handler: () => setShowQuality((v) => !v),
      allowInInput: true,
    },
    "alt+c": {
      handler: () => router.push("/accounting/forms/items"),
      allowInInput: true,
    },
    escape: {
      handler: () => {
        // A dropdown owns the first Escape so a half-filled form survives
        if (document.querySelector(".rs__menu")) return;
        document.activeElement?.blur?.();
      },
      allowInInput: true,
    },
  });

  const FORM_SHORTCUTS = [
    { combo: "Ctrl+S", label: id ? "Update material master" : "Save material master" },
    { combo: "Enter", label: "Move to next field" },
    { combo: "Alt+Q", label: "Toggle Quality Assurance" },
    { combo: "Alt+C", label: "Cancel and go back" },
    { combo: "Esc", label: "Close dropdown / leave field" },
    { combo: "Shift+?", label: "Show this help" },
  ];

  if (itemLoading && id) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-3">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground text-sm">Loading item data…</p>
      </div>
    );
  }



  const categoryLabel = categories.find((c) => String(c.id) === String(formData.ic_id))?.ic_name || "";
  const itemTypeLabel = formData.is_Card === true ? "Master Sample" : formData.is_Card === false && formData.ic_id ? "QC Master Card" : "";
  const saveLabel = id ? "Update item" : "Save item";

  const saveButton = (extra = "") => (
    <Button
      type="submit"
      form="item-form"
      disabled={saveMutation.isPending || codeCheck.exists}
      title={`${saveLabel} (Ctrl + S)`}
      className={`gap-1.5 ${extra}`}
    >
      {saveMutation.isPending ? (
        <><div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />{id ? "Updating…" : "Saving…"}</>
      ) : (
        <>
          <Save className="h-4 w-4" />{saveLabel}
          {!id && tempQualityData.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">+{tempQualityData.length} QA</Badge>
          )}
        </>
      )}
    </Button>
  );

  return (
    <div className="min-h-screen bg-muted/40 pb-20 sm:pb-0" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-3 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/accounting/forms/items")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
            title="Back to items (Alt + C)"
            aria-label="Back to items"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20 sm:flex">
            <Package className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-muted-foreground">Setup · Material Management</p>
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
              <span className="truncate">{id ? formData.item || "Edit item" : "New item"}</span>
              {id && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-primary">ITCD {id}</span>}
              {categoryLabel && <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground">{categoryLabel}</span>}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <KeyboardHint shortcuts={FORM_SHORTCUTS} />
            <Button type="button" variant="outline" onClick={() => router.push("/accounting/forms/items")} className="hidden gap-1.5 sm:inline-flex" title="Cancel (Alt + C)">
              <X className="h-4 w-4" /> Cancel
            </Button>
            {saveButton("hidden sm:inline-flex")}
          </div>
        </div>
      </div>

      <form
        ref={formRef}
        id="item-form"
        onSubmit={handleSubmit}
        className="mx-auto grid max-w-[1400px] gap-4 px-3 py-4 sm:px-6 sm:py-5 xl:grid-cols-[minmax(0,1fr)_300px]"
      >
        <div className="min-w-0 space-y-4">
          {/* ── Identity ── */}
          <Section icon={Tag} title="Identity" subtitle="What the item is and how it is coded">
            <div className={GRID}>
              <Field label="Material Description" required wide>
                <Input
                  ref={firstFieldRef}
                  name="item"
                  value={formData.item}
                  onChange={handleChange}
                  placeholder="Enter material description"
                  className={inputCls}
                  autoComplete="off"
                />
              </Field>

              <Field label="Item Category" hint={categoryOptions.length === 0 ? "No category assigned to you — ask an administrator." : undefined}>
                <SearchableSelect
                  inputId="ic_id"
                  value={formData?.ic_id}
                  onChange={(value) => handleSelectChange("ic_id", value)}
                  options={categoryOptions}
                  placeholder="Search category…"
                />
              </Field>

              <Field label="Item Type">
                <SearchableSelect
                  inputId="is_Card"
                  value={formData.is_Card === true ? "master_sample" : formData.is_Card === false && formData.ic_id ? "qc_card" : ""}
                  onChange={(value) => setFormData((prev) => ({ ...prev, is_Card: value === "master_sample" }))}
                  options={itemTypeOptions}
                  placeholder="Select type"
                />
              </Field>

              <Field label={formData.is_Card ? "Master Sample No" : "QC Master Card No"}>
                <Input
                  name="alternate_id"
                  value={formData.alternate_id}
                  // Saved as an integer (parseInt on submit), so only digits are accepted.
                  onChange={(e) => setFormData((prev) => ({ ...prev, alternate_id: e.target.value.replace(/\D/g, "") }))}
                  inputMode="numeric"
                  placeholder={formData.is_Card ? "Master sample no" : "QC master card no"}
                  className={inputCls}
                  autoComplete="off"
                />
              </Field>

              <Field label="Ink Code">
                <Input
                  name="code"
                  value={formData.code}
                  onChange={handleChange}
                  placeholder="Enter ink code"
                  className={`${inputCls} ${codeCheck.exists ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20" : ""}`}
                  autoComplete="off"
                />
                {codeCheck.checking && <span className="text-[11.5px] text-muted-foreground">Checking…</span>}
                {!codeCheck.checking && codeCheck.exists && (
                  <span className="flex items-center gap-1 text-[11.5px] text-red-700">
                    <AlertTriangle className="h-3 w-3" />
                    Already used by &quot;{codeCheck.item}&quot; (itcd {codeCheck.itcd})
                  </span>
                )}
              </Field>

              <Field label="Customer Code">
                <SearchableSelect
                  inputId="customer_code"
                  value={formData?.customer_code}
                  onChange={(value) => handleSelectChange("customer_code", value)}
                  options={customerOptions}
                  placeholder="Search customer by name or code…"
                  emptyMessage="No customer matches"
                />
              </Field>

              <Field label="With White">
                <label className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input bg-background px-3">
                  <span className="text-sm text-muted-foreground">{formData.with_white === 1 ? "Yes" : "No"}</span>
                  <Switch
                    checked={formData.with_white === 1}
                    onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, with_white: checked ? 1 : 0 }))}
                  />
                </label>
              </Field>
            </div>
          </Section>

          {/* ── Stock & classification ── */}
          <Section icon={Boxes} title="Stock & classification" subtitle="Grouping, unit and stock settings">
            <div className={GRID}>
              <Field label="Main Category">
                <SearchableSelect
                  inputId="mc_id"
                  value={formData?.mc_id}
                  onChange={(value) => handleSelectChange("mc_id", value)}
                  options={mainCategoryOptions}
                  placeholder="Search main category…"
                />
              </Field>

              <Field label="Item Sub Category">
                <SearchableSelect
                  inputId="pc_id"
                  value={formData?.pc_id}
                  onChange={(value) => handleSelectChange("pc_id", value)}
                  options={subCategoryOptions}
                  placeholder="Search sub category…"
                />
              </Field>

              <Field label="Unit of Measurement">
                <Input name="unit" value={formData.unit} onChange={handleChange} placeholder="e.g. KG, LTR, PCS" className={inputCls} autoComplete="off" />
              </Field>

              <Field label="Import Type">
                <SearchableSelect
                  inputId="import_type"
                  value={formData?.import_type}
                  onChange={(value) => handleSelectChange("import_type", value)}
                  options={importTypeOptions}
                  placeholder="Select import type"
                />
              </Field>

              <Field label="Re-Order Level" hint="Stock below this is flagged (Material Procurement, BI)">
                <Input name="re_order" type="number" value={formData.re_order} onChange={handleChange} placeholder="0" className={inputCls} />
              </Field>

              <Field label="Minimum Order Qty" hint="Smallest quantity to order (Material Procurement)">
                <Input name="minimum_order_quantity" type="number" step="0.01" min="0" value={formData.minimum_order_quantity} onChange={handleChange} placeholder="0" className={inputCls} />
              </Field>

              {features.on("grn.directRateByItem") && (
                <Field label="Rate entered on the GRN" hint="The GRN rate, not the PO rate, is invoiced">
                  <label className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input bg-background px-3">
                    <span className="text-sm text-muted-foreground">{formData.grn_direct_rate ? "Yes" : "No (or as its category)"}</span>
                    <Switch
                      checked={formData.grn_direct_rate === true}
                      onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, grn_direct_rate: checked }))}
                    />
                  </label>
                </Field>
              )}

              <Field label="Wastage %">
                <Input name="wastage_percentage" type="number" step="0.01" min="0" max="100" value={formData.wastage_percentage} onChange={handleChange} placeholder="0.00" className={inputCls} />
              </Field>

              <Field label="LTR Rate" hint="Litre rate">
                <Input name="ltr_rate" type="number" step="0.01" value={formData.ltr_rate} onChange={handleChange} placeholder="0.00" className={inputCls} />
              </Field>

              <Field label="Packing Material" hint={!isPackingMaterialEnabled ? "For finished goods only" : undefined} wide>
                <SearchableSelect
                  inputId="packing_material_code"
                  value={formData?.packing_material_code}
                  onChange={(value) => handleSelectChange("packing_material_code", value)}
                  options={packingMaterialOptions}
                  isDisabled={!isPackingMaterialEnabled}
                  placeholder={!isPackingMaterialEnabled ? "Choose the finished-goods category first" : "Search packing material…"}
                  emptyMessage="No packing materials available"
                />
              </Field>
            </div>
          </Section>

          {/* ── Product specifications ── */}
          <Section icon={Palette} title="Product specifications" subtitle="Ink properties">
            <div className={GRID}>
              <Field label="Nature of Ink" htmlFor="nature_of_ink">
                <SearchableSelect inputId="nature_of_ink" value={formData.nature_of_ink} onChange={(value) => handleSelectChange("nature_of_ink", value)} options={natureOfInksOptions} placeholder="Search nature of ink…" />
              </Field>
              <Field label="Ink Series" htmlFor="ink_type">
                <SearchableSelect inputId="ink_type" value={formData.ink_type} onChange={(value) => handleSelectChange("ink_type", value)} options={inkTypesOptions} placeholder="Search ink series…" />
              </Field>
              <Field label="SR Lamination" htmlFor="sr_lamination">
                <SearchableSelect inputId="sr_lamination" value={formData.lamination} onChange={(value) => handleSelectChange("lamination", value)} options={srLaminationsOptions} placeholder="Search SR lamination…" />
              </Field>
              <Field label="Color Code" htmlFor="color">
                <SearchableSelect inputId="color" value={formData.color} onChange={(value) => handleSelectChange("color", value)} options={colorCodesOptions} placeholder="Search color code…" />
              </Field>
              <Field label="Substrates" htmlFor="subtrates">
                <SearchableSelect inputId="subtrates" value={formData.subtrates} onChange={(value) => handleSelectChange("subtrates", value)} options={substratesOptions} placeholder="Search substrate…" />
              </Field>
              <Field label="Business Unit" htmlFor="business_unit">
                <SearchableSelect inputId="business_unit" value={formData.business_unit} onChange={(value) => handleSelectChange("business_unit", value)} options={businessUnitsOptions} placeholder="Search business unit…" />
              </Field>
              <Field label="Printing Property" htmlFor="printing_property">
                <SearchableSelect inputId="printing_property" value={formData.printing_property} onChange={(value) => handleSelectChange("printing_property", value)} options={printingPropertiesOptions} placeholder="Search printing property…" />
              </Field>
            </div>
          </Section>

          {/* ── Validity ── */}
          <Section icon={CalendarRange} title="Validity" subtitle="From today to year 9999 unless changed">
            <div className={GRID}>
              <Field label="Valid From">
                <Input name="valid_from" type="date" value={formData.valid_from || ""} onChange={handleChange} className={inputCls} />
              </Field>
              <Field label="Valid To">
                <Input name="valid_to" type="date" value={formData.valid_to || ""} onChange={handleChange} className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* ── Quality assurance (collapsible) ── */}
          <section className="overflow-hidden rounded-xl border border-border bg-background">
            <button
              type="button"
              onClick={() => setShowQuality((v) => !v)}
              className="flex w-full items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3 text-left hover:bg-primary/10"
              aria-expanded={showQuality}
            >
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-primary">
                  Quality assurance
                  {qualityMatrixData.length > 0 && (
                    <span className="rounded-full bg-[#edf2ee] px-2 py-0.5 text-[11px] font-semibold text-[#2f5139]">{qualityMatrixData.length} parameters</span>
                  )}
                  {!id && tempQualityData.length > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Saved with the item</span>
                  )}
                </h2>
                <p className="text-xs text-muted-foreground">Quality standards checked on this item · Alt+Q</p>
              </div>
              <ChevronDown className={`h-5 w-5 text-primary transition-transform ${showQuality ? "rotate-180" : ""}`} />
            </button>

            {showQuality && (
              <div className="space-y-4 p-4 sm:p-5">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Parameters", value: qualityParams.length },
                    { label: "Assigned", value: qualityMatrixData.length },
                    { label: "Available", value: availableParameters.length },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                      <p className="text-[11.5px] text-muted-foreground">{label}</p>
                      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
                    </div>
                  ))}
                </div>

                {qualityMatrixData.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                    No quality parameters yet — add one below.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="hidden grid-cols-[minmax(0,220px)_minmax(0,1fr)_44px] bg-primary px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-primary-foreground sm:grid">
                      <span>Parameter</span><span>Standard</span><span />
                    </div>
                    {qualityMatrixData.map((param, index) => (
                      <div key={param.parameter_name} className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-2 border-t border-border px-3 py-2 first:border-t-0 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_44px]">
                        <span className="col-span-2 flex items-center gap-2 text-sm font-semibold text-foreground sm:col-span-1">
                          {param.parameter_name}
                          {param.isDirty && id && <span className="rounded-full bg-[#f5f0e6] px-1.5 text-[10.5px] font-semibold text-[#5f4b1f]">Changed</span>}
                        </span>
                        <Input
                          value={param.quality_standard || ""}
                          onChange={(e) => handleQualityMatrixChange(index, "quality_standard", e.target.value)}
                          placeholder="Standard value"
                          className="h-9 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveParameter(param.parameter_name)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Remove ${param.parameter_name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="mb-2 text-[12.5px] font-semibold text-foreground/80">Add a parameter</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <SearchableSelect
                      inputId="new_quality_param"
                      value={newParam}
                      onChange={(value) => setNewParam(value || "")}
                      options={availableParameterOptions}
                      placeholder="Search parameter…"
                      emptyMessage="No parameters available"
                    />
                    <Input
                      placeholder="Standard value"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      className="h-10 text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddParameter(); } }}
                    />
                    <Button type="button" onClick={handleAddParameter} disabled={!newParam || !newValue} className="h-10 gap-1.5">
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </div>
                </div>

                {id ? (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => saveQualityMatrixMutation.mutate()}
                      disabled={saveQualityMatrixMutation.isPending || !hasUnsavedQualityChanges}
                      className="gap-1.5 border-primary/40 text-primary hover:bg-primary/5"
                    >
                      {saveQualityMatrixMutation.isPending ? (
                        <><div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />Saving…</>
                      ) : (
                        <><Save className="h-4 w-4" />Save quality matrix</>
                      )}
                    </Button>
                  </div>
                ) : (
                  tempQualityData.length > 0 && (
                    <p className="text-center text-xs text-muted-foreground">
                      {tempQualityData.length} parameter(s) will be saved with the item.
                    </p>
                  )
                )}
              </div>
            )}
          </section>
        </div>

        {/* ── Summary (wide screens) ── */}
        <aside className="hidden xl:block">
          <div className="sticky top-24 space-y-3">
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="border-b border-primary/15 bg-primary/5 px-4 py-3">
                <h2 className="text-[15px] font-semibold text-primary">Summary</h2>
              </div>
              <div className="divide-y divide-border px-4">
                <SummaryRow label="ITCD">{id ? <span className="font-mono">{id}</span> : <span className="text-muted-foreground">Given on save</span>}</SummaryRow>
                <SummaryRow label="Description">{formData.item || "—"}</SummaryRow>
                <SummaryRow label="Category">{categoryLabel || "—"}</SummaryRow>
                <SummaryRow label="Type">{itemTypeLabel || "—"}</SummaryRow>
                <SummaryRow label="Ink code">{formData.code || "—"}</SummaryRow>
                <SummaryRow label="Unit">{formData.unit || "—"}</SummaryRow>
                <SummaryRow label="Quality">{qualityMatrixData.length} parameters</SummaryRow>
                <SummaryRow label="Valid">{formData.valid_from || "—"} → {formData.valid_to || "—"}</SummaryRow>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {saveButton("w-full")}
              <Button type="button" variant="outline" onClick={() => router.push("/accounting/forms/items")} className="w-full gap-1.5">
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </div>
        </aside>
      </form>

      {/* Phone: save bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-border bg-background/95 px-3 py-2.5 backdrop-blur sm:hidden">
        <Button type="button" variant="outline" onClick={() => router.push("/accounting/forms/items")} className="h-11 flex-1 gap-1.5">
          <X className="h-4 w-4" /> Cancel
        </Button>
        {saveButton("h-11 flex-[2]")}
      </div>

      <ItemSaveSuccessDialog
        result={saveResult}
        onClose={() => {
          setSaveResult(null);
          router.push("/accounting/forms/items");
        }}
      />
    </div>
  );
}
