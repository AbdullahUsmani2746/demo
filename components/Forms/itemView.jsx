"use client";

// Item master — read-only view (/accounting/forms/items/[id]/view).
// Esc / Alt+C back to the list; Alt+E opens the item for editing (when the
// person may edit its category — Admin → Permissions → Data scope).
import React, { useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Boxes, CalendarRange, FlaskConical, Lock, Package,
  Palette, Pencil, ShieldCheck, Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchItem, fetchSubtrates, fetchCategories, fetchItemQuality, fetchPackingMaterials,
} from "@/lib/api";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";

const getJson = async (url, pick) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const json = await res.json();
  return pick(json);
};

const fmtDate = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return isNaN(x) ? "" : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const Section = ({ icon: Icon, title, children, className = "" }) => (
  <section className={`overflow-hidden rounded-xl border border-border bg-background ${className}`}>
    <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
      {Icon && <Icon className="h-4 w-4 text-primary" />}
      <h2 className="text-[15px] font-semibold text-primary">{title}</h2>
    </div>
    <dl className="grid grid-cols-1 gap-x-6 px-4 sm:grid-cols-2">{children}</dl>
  </section>
);

// One label / value pair; an empty value shows a soft dash.
const Row = ({ label, children, mono }) => {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 py-2.5 text-sm last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 text-right font-medium text-foreground ${mono ? "font-mono" : ""}`}>
        {empty ? <span className="text-muted-foreground/60">—</span> : children}
      </dd>
    </div>
  );
};

const Stat = ({ label, value }) => (
  <div className="rounded-xl border border-border bg-background px-4 py-3">
    <p className="text-[12px] text-muted-foreground">{label}</p>
    <p className="truncate text-base font-semibold text-foreground">{value || "—"}</p>
  </div>
);

// Older lab properties kept on the item itself (before the quality matrix).
const LEGACY_PROPS = [
  ["viscosity", "Viscosity"], ["opacity", "Opacity"], ["gloss", "Gloss"], ["fineness", "Fineness"],
  ["solid", "Solid content"], ["adhesion", "Adhesion"], ["color_bulk", "Color bulk"],
  ["e", "E value"], ["a", "A value"], ["l", "L value"], ["b", "B value"],
];

export default function ItemView() {
  const router = useRouter();
  const { id } = useParams();

  const { data: item, isLoading, isError } = useQuery({
    queryKey: ["item", id],
    queryFn: () => fetchItem(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
  const { data: quality = [] } = useQuery({
    queryKey: ["itemQuality", id],
    queryFn: () => fetchItemQuality(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 5 * 60 * 1000 });
  const { data: subtrates = [] } = useQuery({ queryKey: ["subtrates"], queryFn: fetchSubtrates, staleTime: 5 * 60 * 1000 });
  const { data: packingMaterials = [] } = useQuery({ queryKey: ["packingMaterials"], queryFn: fetchPackingMaterials, staleTime: 5 * 60 * 1000 });
  const { data: mainCategories = [] } = useQuery({
    queryKey: ["mainCategories"],
    queryFn: () => getJson("/api/setup/item_main_categories", (r) => r.data ?? []),
    staleTime: 5 * 60 * 1000,
  });
  const { data: subCategories = [] } = useQuery({
    queryKey: ["itemSubCategories"],
    queryFn: () => getJson("/api/setup/item_sub_categories", (r) => r.data ?? []),
    staleTime: 5 * 60 * 1000,
  });
  // Only the one customer this item names (not the whole customer list).
  const { data: customer } = useQuery({
    queryKey: ["itemCustomer", item?.customer_code],
    queryFn: () => getJson(`/api/accounts/acno?acno=${item.customer_code}`, (r) => (r.data ?? [])[0] ?? null),
    enabled: !!item?.customer_code,
    staleTime: 5 * 60 * 1000,
  });
  // May this person edit items of this category? (null list = every category)
  const { data: manageable } = useQuery({
    queryKey: ["itemManageCategories"],
    queryFn: () => getJson("/api/forms/items/categories", (r) => r),
    staleTime: 5 * 60 * 1000,
  });

  const canEdit = useMemo(() => {
    if (!item || !manageable?.limited) return true;
    return (manageable.categories || []).some((c) => Number(c.id) === Number(item.ic_id));
  }, [item, manageable]);

  const goEdit = () => canEdit && router.push(`/accounting/forms/items/${id}`);
  useKeyboardShortcuts({
    escape: { handler: () => router.push("/accounting/forms/items"), allowInInput: true },
    "alt+c": { handler: () => router.push("/accounting/forms/items"), allowInInput: true },
    "alt+e": { handler: goEdit, allowInInput: true },
  });

  const nameOf = (list, idValue, key, field) => {
    if (idValue === null || idValue === undefined || idValue === "") return "";
    return list.find((x) => String(x[key]) === String(idValue))?.[field] ?? "";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/40">
        <div className="mx-auto max-w-[1400px] space-y-4 px-3 py-5 sm:px-6">
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
          <div className="grid gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <p className="font-semibold text-foreground">Couldn&apos;t load this item</p>
        <p className="text-sm text-muted-foreground">It may have been deleted, or the connection dropped.</p>
        <Button variant="outline" onClick={() => router.push("/accounting/forms/items")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to items
        </Button>
      </div>
    );
  }

  const category = nameOf(categories, item.ic_id, "id", "ic_name");
  const itemType = item.is_Card === true ? "Master Sample" : item.is_Card === false ? "QC Master Card" : "";
  const importType = String(item.import_type || "").toUpperCase().startsWith("IMPORT") ? "Imported" : item.import_type ? "Local" : "";
  const legacy = LEGACY_PROPS.filter(([k]) => item[k] !== null && item[k] !== undefined && item[k] !== "");

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-3 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/accounting/forms/items")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
            title="Back to items (Esc)"
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
              <span className="min-w-0 break-words">{item.item || "Unnamed item"}</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-primary">ITCD {item.itcd}</span>
              {category && <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground">{category}</span>}
            </h1>
          </div>
          {canEdit ? (
            <Button onClick={goEdit} className="gap-1.5" title="Edit (Alt + E)">
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground" title="Another team manages this category">
              <Lock className="h-4 w-4" /> Read-only
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-3 py-4 sm:px-6 sm:py-5">
        {/* Key figures */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Category" value={category} />
          <Stat label="Unit" value={item.unit} />
          <Stat label="Type" value={itemType} />
          <Stat label="Quality parameters" value={String(quality.length)} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section icon={Tag} title="Identity">
            <Row label="Description">{item.item}</Row>
            <Row label="ITCD" mono>{item.itcd}</Row>
            <Row label="Ink code" mono>{item.code}</Row>
            <Row label={item.is_Card ? "Master sample no" : "QC master card no"} mono>{item.alternate_id}</Row>
            <Row label="Type">{itemType}</Row>
            <Row label="Customer">{customer ? `${customer.acname} (${customer.acno})` : item.customer_code}</Row>
            <Row label="With white">{item.with_white === 1 ? "Yes" : "No"}</Row>
          </Section>

          <Section icon={Boxes} title="Stock & classification">
            <Row label="Category">{category}</Row>
            <Row label="Main category">{nameOf(mainCategories, item.mc_id, "id", "mc_name")}</Row>
            <Row label="Sub category">{nameOf(subCategories, item.pc_id, "id", "pc_name")}</Row>
            <Row label="Unit">{item.unit}</Row>
            <Row label="Import type">{importType}</Row>
            <Row label="Re-order level">{item.re_order}</Row>
            <Row label="Wastage %">{item.wastage_percentage}</Row>
            <Row label="LTR rate">{item.ltr_rate}</Row>
            <Row label="Packing material">{nameOf(packingMaterials, item.packing_material_code, "itcd", "item")}</Row>
          </Section>

          <Section icon={Palette} title="Product specifications">
            <Row label="Nature of ink">{item.nature_of_ink}</Row>
            <Row label="Ink series">{item.ink_type}</Row>
            <Row label="SR lamination">{item.lamination}</Row>
            <Row label="Color code">{item.color}</Row>
            <Row label="Substrate">{nameOf(subtrates, item.subtrates, "id", "subtrate") || item.subtrates}</Row>
            <Row label="Business unit">{item.business_unit}</Row>
            <Row label="Printing property">{item.printing_property}</Row>
          </Section>

          <Section icon={CalendarRange} title="Validity">
            <Row label="Valid from">{fmtDate(item.valid_from)}</Row>
            <Row label="Valid to">{fmtDate(item.valid_to)}</Row>
          </Section>
        </div>

        {/* Quality matrix */}
        <section className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="flex-1 text-[15px] font-semibold text-primary">Quality assurance</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-semibold text-primary">{quality.length}</span>
          </div>
          {quality.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <FlaskConical className="h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No quality parameters set for this item.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-primary px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-primary-foreground sm:grid">
                <span>Parameter</span><span>Standard</span>
              </div>
              {quality.map((q) => (
                <div key={q.parameter_name} className="grid grid-cols-1 gap-0.5 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
                  <span className="font-medium text-foreground">{q.parameter_name}</span>
                  <span className="text-muted-foreground sm:text-foreground">{q.quality_standard || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Older lab properties — only when the item still carries any */}
        {legacy.length > 0 && (
          <Section icon={FlaskConical} title="Lab properties (older records)">
            {legacy.map(([k, label]) => (
              <Row key={k} label={label}>{item[k]}</Row>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
