"use client";
// ============================================================
// POS terminal — the till. Products (search, scan, category tiles) on the
// left, the bill on the right (a slide-up sheet on a phone). Everything the
// server needs is posted by lib/pos/posting.js through POST /api/pos/orders;
// the figures shown here come from the same lib/pos/calc.js.
//
// Keyboard: F2 search · F3 customer · F4 bill discount · F6 hold · F7 recall
// · F8 last receipt · F9 pay (cash) · F10 pay by card · ↑ ↓ pick a line ·
// + / − quantity · Del remove line · Esc clear search / close.
// A barcode scanner (keyboard wedge) works anywhere on the screen.
//
// Slow / lost network: the bill is kept in this browser until it is saved;
// every sale carries a clientRef, so retrying a sale that did reach the server
// returns the same receipt instead of posting it twice.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Barcode, ChevronDown, ChevronUp, Minus, PackageSearch, Pause, Percent, Play, Plus, Receipt, Search,
  ShoppingCart, StickyNote, Trash2, UserRound, WifiOff, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import useBarcodeScan from "@/hooks/useBarcodeScan";
import { computeBill, largestDiscountPercent, round2 } from "@/lib/pos/calc";
import { usePosBoot, POS_BOOT_KEY, useMoney, fmt, fmtQty, apiError, newClientRef, Kbd } from "@/components/POS/shared";
import PaymentDialog from "@/components/POS/terminal/PaymentDialog";
import CustomerDialog from "@/components/POS/terminal/CustomerDialog";
import HeldBillsDialog, { HELD_KEY, useHeldBills } from "@/components/POS/terminal/HeldBillsDialog";
import ReceiptDialog from "@/components/POS/ReceiptDialog";
import { useRouter } from "next/navigation";

const DRAFT_KEY = "pos:draft:v1";
const emptyBill = () => ({ lines: [], customer: null, billDiscount: { type: "pct", value: 0 }, note: "", clientRef: newClientRef() });
const readDraft = () => {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d && Array.isArray(d.lines) ? { ...emptyBill(), ...d } : emptyBill();
  } catch {
    return emptyBill();
  }
};
let lineSeq = 0;
const lineKey = () => `l${Date.now().toString(36)}${(lineSeq++).toString(36)}`;

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

export default function PosTerminal() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: boot, isLoading: bootLoading, error: bootError } = usePosBoot();
  const settings = boot?.settings;
  const rights = boot?.rights || {};
  const { symbol, money } = useMoney();
  const online = useOnline();

  const [bill, setBill] = useState(emptyBill);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState(0);
  const [cartOpen, setCartOpen] = useState(false); // phone: bill sheet
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState("CASH");
  const [custOpen, setCustOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payError, setPayError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [busyHeld, setBusyHeld] = useState(null);
  const searchRef = useRef(null);

  // ── draft kept in this browser ──
  useEffect(() => { setBill(readDraft()); setLoaded(true); }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(bill)); } catch { /* private mode: not kept */ }
  }, [bill, loaded]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 180);
    return () => clearTimeout(t);
  }, [search]);

  const { data: catalog, isFetching: catLoading } = useQuery({
    queryKey: ["pos", "catalog", debounced, category],
    queryFn: async () => (await axios.get("/api/pos/catalog", { params: { search: debounced || undefined, category: category || undefined, take: 60 } })).data,
    enabled: !!boot,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
  const products = catalog?.items || [];
  const { data: held = [] } = useHeldBills(!!boot && rights.sell);

  // ── bill arithmetic (same as the server) ──
  const calcSettings = useMemo(() => ({ taxPercent: settings?.taxPercent || 0, roundTo: settings?.roundTo || 0 }), [settings]);
  const computed = useMemo(() => computeBill(bill.lines, bill.billDiscount, calcSettings), [bill.lines, bill.billDiscount, calcSettings]);
  const worstDiscount = largestDiscountPercent(computed);
  const discountAllowed = !!settings?.allowDiscounts && !!rights.discount;
  const priceAllowed = !!settings?.allowPriceChange && !!rights.discount;
  const needsPrice = bill.lines.some((l) => !(Number(l.rate) > 0) && !(l.listPrice > 0));
  const overDiscount = computed.discount > 0 && settings && worstDiscount > settings.maxDiscountPercent + 0.001;
  const itemCount = bill.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const canPay = bill.lines.length > 0 && computed.total > 0 && !needsPrice && !overDiscount && (!computed.discount || discountAllowed);
  const allowCredit = !!boot?.features?.creditSales && !!rights.credit && !!bill.customer?.acno;
  const creditHint = !boot?.features?.creditSales
    ? "Credit sales are off (Settings → Features → Point of sale)."
    : !rights.credit
      ? "You may not sell on credit (pos.credit)."
      : !bill.customer?.acno
        ? "Pick a customer account (F3) to put the bill on account."
        : "";
  const shiftNeeded = !!boot?.features?.requireShift && !boot?.shift;

  // ── bill editing ──
  const update = (fn) => setBill((b) => ({ ...b, ...fn(b) }));
  const addItem = useCallback((p, qty = 1) => {
    if (!p) return;
    setBill((b) => {
      const i = b.lines.findIndex((l) => l.itcd === p.itcd && !l.note && !l.discountPct && Number(l.rate) === Number(p.price));
      if (i >= 0) {
        const lines = b.lines.map((l, j) => (j === i ? { ...l, qty: round2(Number(l.qty) + qty) } : l));
        setSelected(i);
        return { ...b, lines };
      }
      const line = { key: lineKey(), itcd: p.itcd, name: p.item, code: p.code, unit: p.unit, listPrice: Number(p.price) || 0, rate: Number(p.price) || 0, qty, discountPct: 0, note: "", stock: p.stock };
      setSelected(b.lines.length);
      return { ...b, lines: [...b.lines, line] };
    });
    if (!(Number(p.price) > 0)) toast.message(`${p.item} has no price — type its price on the bill.`);
  }, []);
  const setLine = (i, patch) => update((b) => ({ lines: b.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const removeLine = (i) => {
    update((b) => ({ lines: b.lines.filter((_, j) => j !== i) }));
    setSelected((s) => Math.min(s, bill.lines.length - 2));
  };
  const clearBill = () => { setBill(emptyBill()); setSelected(-1); setPayError(""); };

  // ── scanning / search enter ──
  const lookupCode = useCallback(async (code) => {
    const c = String(code || "").trim();
    if (!c) return false;
    try {
      const { data } = await axios.get("/api/pos/catalog", { params: { code: c } });
      if (data.items?.length) { addItem(data.items[0]); return true; }
    } catch (err) {
      toast.error(apiError(err, "Could not look the item up."));
      return true;
    }
    return false;
  }, [addItem]);

  useBarcodeScan({
    onComplete: async (code) => {
      if (document.activeElement === searchRef.current) return; // the search box handles its own Enter
      if (payOpen || custOpen || heldOpen || receipt) return;
      if (!(await lookupCode(code))) toast.error(`No item with code ${code}`);
    },
    minLength: 3,
    averageWaitTime: 40,
  });

  const onSearchKey = async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const term = search.trim();
      if (!term) { if (canPay) openPay("CASH"); return; }
      if (await lookupCode(term)) { setSearch(""); return; }
      if (products.length === 1 || (products.length && debounced === term)) { addItem(products[0]); setSearch(""); }
    } else if (e.key === "Escape") {
      setSearch("");
    } else if (e.key === "ArrowDown" && bill.lines.length) {
      e.preventDefault();
      searchRef.current?.blur();
      setSelected(0);
    }
  };

  const openPay = (m) => {
    if (!canPay) return;
    if (shiftNeeded) { toast.error("Open a shift first (Shift)."); return; }
    setPayError("");
    setPayMethod(m);
    setPayOpen(true);
  };

  // ── save ──
  const complete = async (payments) => {
    if (saving) return;
    setSaving(true);
    setPayError("");
    try {
      const body = {
        clientRef: bill.clientRef,
        lines: bill.lines.map((l) => ({ itcd: l.itcd, qty: Number(l.qty), rate: Number(l.rate), discountPct: Number(l.discountPct) || 0, note: l.note || undefined })),
        billDiscount: bill.billDiscount,
        customer: bill.customer || undefined,
        payments,
        note: bill.note || undefined,
      };
      const { data } = await axios.post("/api/pos/orders", body, { timeout: 30_000 });
      (data.warnings || []).forEach((w) => toast.warning(w));
      setPayOpen(false);
      setCartOpen(false);
      setLastReceipt(data.receipt);
      clearBill();
      queryClient.invalidateQueries({ queryKey: ["pos", "catalog"] });
      queryClient.invalidateQueries({ queryKey: POS_BOOT_KEY });
      if (settings?.printAfterSale !== false) { setJustSaved(true); setReceipt(data.receipt); }
      else toast.success(`Saved ${data.receipt?.invoice_no} · ${money(data.receipt?.total)}`);
    } catch (err) {
      setPayError(apiError(err, "The sale could not be saved."));
    } finally {
      setSaving(false);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  };

  // ── hold / recall ──
  const hold = async () => {
    if (!bill.lines.length) { toast.message("Nothing on the bill to hold."); return; }
    try {
      const label = bill.customer?.name || `${bill.lines[0].name}${bill.lines.length > 1 ? ` +${bill.lines.length - 1}` : ""}`;
      await axios.post("/api/pos/held", { label, data: { ...bill, total: computed.total } });
      queryClient.invalidateQueries({ queryKey: HELD_KEY });
      clearBill();
      toast.success("Bill put on hold (F7 to recall).");
    } catch (err) {
      toast.error(apiError(err, "Could not hold the bill."));
    }
  };
  const recall = async (b) => {
    setBusyHeld(b.id);
    try {
      if (bill.lines.length) await axios.post("/api/pos/held", { label: bill.customer?.name || bill.lines[0].name, data: { ...bill, total: computed.total } });
      const { data } = await axios.delete(`/api/pos/held/${b.id}`);
      const d = data.bill.data || {};
      setBill({ ...emptyBill(), ...d, lines: (d.lines || []).map((l) => ({ ...l, key: l.key || lineKey() })), clientRef: newClientRef() });
      setSelected(-1);
      setHeldOpen(false);
      queryClient.invalidateQueries({ queryKey: HELD_KEY });
    } catch (err) {
      toast.error(apiError(err, "Could not recall the bill."));
      queryClient.invalidateQueries({ queryKey: HELD_KEY });
    } finally {
      setBusyHeld(null);
    }
  };
  const discard = async (b) => {
    if (!window.confirm("Discard this held bill?")) return;
    setBusyHeld(b.id);
    try { await axios.delete(`/api/pos/held/${b.id}`); } catch (err) { toast.error(apiError(err)); }
    queryClient.invalidateQueries({ queryKey: HELD_KEY });
    setBusyHeld(null);
  };

  // ── keyboard ──
  const anyDialog = payOpen || custOpen || heldOpen || discOpen || !!receipt;
  useEffect(() => {
    const onKey = (e) => {
      if (anyDialog) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      const k = e.key;
      // Only the keys the till uses (F5 reload, F11 full screen, F12 stay the browser's).
      if (["F2", "F3", "F4", "F6", "F7", "F8", "F9", "F10"].includes(k)) e.preventDefault();
      if (k === "F2") { searchRef.current?.focus(); searchRef.current?.select(); }
      else if (k === "F3") setCustOpen(true);
      else if (k === "F4") { if (discountAllowed) setDiscOpen(true); }
      else if (k === "F6") hold();
      else if (k === "F7") setHeldOpen(true);
      else if (k === "F8") { if (lastReceipt) { setJustSaved(false); setReceipt(lastReceipt); } }
      else if (k === "F9") openPay("CASH");
      else if (k === "F10") openPay("CARD");
      else if (!typing && bill.lines.length) {
        if (k === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, bill.lines.length - 1)); }
        else if (k === "ArrowUp") { e.preventDefault(); setSelected((s) => (s <= 0 ? (searchRef.current?.focus(), -1) : s - 1)); }
        else if ((k === "+" || k === "=") && selected >= 0) { e.preventDefault(); setLine(selected, { qty: round2(Number(bill.lines[selected].qty) + 1) }); }
        else if ((k === "-" || k === "_") && selected >= 0) { e.preventDefault(); const q = Number(bill.lines[selected].qty); if (q > 1) setLine(selected, { qty: round2(q - 1) }); }
        else if ((k === "Delete" || k === "Backspace") && selected >= 0) { e.preventDefault(); removeLine(selected); }
        else if (k === "Escape") setSelected(-1);
        else if (k.length === 1 && /[\w]/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) searchRef.current?.focus();
      } else if (!typing && k.length === 1 && /[\w]/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── render ──
  if (bootLoading) return <div className="flex h-[60vh] items-center justify-center text-muted-foreground">Opening the till…</div>;
  if (bootError) return <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive">{apiError(bootError, "The till could not be opened.")}</div>;

  const customerLabel = bill.customer?.name || boot?.walkIn?.acname || settings?.walkInName || "Walk-in Customer";

  const billPanel = (
    <BillPanel
      bill={bill}
      computed={computed}
      selected={selected}
      setSelected={setSelected}
      setLine={setLine}
      removeLine={removeLine}
      discountAllowed={discountAllowed}
      priceAllowed={priceAllowed}
      maxDiscount={settings?.maxDiscountPercent ?? 100}
      overDiscount={overDiscount}
      needsPrice={needsPrice}
      symbol={symbol}
      customerLabel={customerLabel}
      onCustomer={() => setCustOpen(true)}
      onDiscount={() => setDiscOpen(true)}
      onHold={hold}
      onRecall={() => setHeldOpen(true)}
      heldCount={held.length}
      onClear={() => { if (!bill.lines.length || window.confirm("Clear this bill?")) clearBill(); }}
      onPay={openPay}
      canPay={canPay && !shiftNeeded}
      itemCount={itemCount}
      onCloseSheet={() => setCartOpen(false)}
      stockMode={boot?.stockMode}
      allowCreditBtn={!!boot?.features?.creditSales && !!rights.credit}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col lg:flex-row">
      {/* ── products ── */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-border bg-background px-3 pb-2 pt-3 sm:px-4">
          {(!online || (boot?.problems || []).length > 0 || shiftNeeded) && (
            <div className="space-y-1">
              {!online && (
                <p className="flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-1.5 text-[12.5px] font-medium text-amber-900">
                  <WifiOff className="h-4 w-4" /> Offline — keep ringing up; the bill is kept here and can be paid when the connection is back.
                </p>
              )}
              {(boot?.problems || []).map((p) => (
                <p key={p} className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-1.5 text-[12.5px] font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {p}
                </p>
              ))}
              {shiftNeeded && (
                <p className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-primary">
                  <Play className="h-4 w-4" /> Open a shift before the first sale.
                  <Button size="sm" className="h-7" onClick={() => router.push("/pos/shift")}>Open shift</Button>
                </p>
              )}
            </div>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Search item, code — or scan a barcode"
              aria-label="Search items or scan a barcode"
              className="h-12 w-full rounded-xl border border-input bg-muted/40 pl-11 pr-24 text-base focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-muted-foreground">
              <Barcode className="h-5 w-5" /> <Kbd>F2</Kbd>
            </span>
          </div>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4" role="tablist" aria-label="Categories">
            {[{ id: 0, name: "All" }, ...(boot?.categories || [])].map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={category === c.id}
                onClick={() => setCategory(c.id)}
                className={`min-h-[40px] flex-shrink-0 rounded-full border px-4 text-[13px] font-semibold transition-colors ${
                  category === c.id ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-background text-foreground/80 hover:border-primary/40 hover:text-primary"
                }`}
              >
                {c.name}
                {c.count ? <span className={`ml-1.5 text-[11px] ${category === c.id ? "text-white/75" : "text-muted-foreground"}`}>{c.count}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-3 pb-28 sm:p-4 lg:pb-4">
          {!products.length && !catLoading && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <PackageSearch className="h-10 w-10 opacity-40" />
              <p className="text-sm">{debounced ? `Nothing matches “${debounced}”.` : "No items to sell — check Settings → Point of Sale → Item categories."}</p>
            </div>
          )}
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {products.map((p) => {
              const inBill = bill.lines.filter((l) => l.itcd === p.itcd).reduce((s, l) => s + Number(l.qty || 0), 0);
              const low = p.stock <= 0;
              return (
                <li key={p.itcd}>
                  <button
                    type="button"
                    onClick={() => addItem(p)}
                    className={`group relative flex h-full min-h-[104px] w-full flex-col rounded-xl border bg-background p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md active:scale-[0.98] ${inBill ? "border-primary ring-1 ring-primary/30" : "border-border"}`}
                  >
                    {inBill > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-bold text-primary-foreground shadow">{fmtQty(inBill)}</span>
                    )}
                    <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-foreground">{p.item}</span>
                    {p.code && <span className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.code}</span>}
                    <span className="mt-auto flex items-end justify-between gap-2 pt-2">
                      <span className="text-[15px] font-bold tabular-nums text-primary">{p.price > 0 ? fmt(p.price) : "Price?"}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ${low ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {fmtQty(p.stock)} {p.unit || ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 hidden flex-wrap justify-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground lg:flex">
            <span><Kbd>F2</Kbd> search</span><span><Kbd>F3</Kbd> customer</span>{discountAllowed && <span><Kbd>F4</Kbd> discount</span>}
            <span><Kbd>F6</Kbd> hold</span><span><Kbd>F7</Kbd> recall</span><span><Kbd>F8</Kbd> last receipt</span>
            <span><Kbd>F9</Kbd> cash</span><span><Kbd>F10</Kbd> card</span><span><Kbd>↑↓</Kbd> line</span><span><Kbd>+</Kbd><Kbd>−</Kbd> qty</span><span><Kbd>Del</Kbd> remove</span>
          </p>
        </div>
      </section>

      {/* ── bill: side panel from lg, sheet below ── */}
      <aside className="hidden min-h-0 w-[400px] flex-shrink-0 flex-col border-l border-border bg-background lg:flex xl:w-[440px]">{billPanel}</aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden">
        <div className="flex gap-2">
          <button type="button" onClick={() => setCartOpen(true)} className="flex min-h-[52px] flex-1 items-center gap-3 rounded-xl border border-border px-3 text-left">
            <span className="relative">
              <ShoppingCart className="h-6 w-6 text-primary" />
              {bill.lines.length > 0 && <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">{fmtQty(itemCount)}</span>}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">View bill</span>
              <span className="block text-lg font-bold tabular-nums leading-tight">{fmt(computed.total)}</span>
            </span>
            <ChevronUp className="ml-auto h-5 w-5 text-muted-foreground" />
          </button>
          <Button className="min-h-[52px] px-6 text-base font-bold" disabled={!canPay || shiftNeeded} onClick={() => openPay("CASH")}>Pay</Button>
        </div>
      </div>
      {cartOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Bill">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 top-10 flex flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl sm:left-auto sm:top-0 sm:w-[420px] sm:rounded-none">{billPanel}</div>
        </div>
      )}

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        total={computed.total}
        symbol={symbol}
        allowCredit={allowCredit}
        creditHint={creditHint}
        initialMethod={payMethod}
        saving={saving}
        error={payError}
        onComplete={complete}
      />
      <CustomerDialog open={custOpen} onOpenChange={setCustOpen} value={bill.customer} onChange={(c) => update(() => ({ customer: c }))} walkInName={settings?.walkInName} />
      <HeldBillsDialog open={heldOpen} onOpenChange={setHeldOpen} onRecall={recall} onDiscard={discard} busyId={busyHeld} />
      <BillDiscountDialog
        open={discOpen}
        onOpenChange={setDiscOpen}
        value={bill.billDiscount}
        note={bill.note}
        max={settings?.maxDiscountPercent ?? 100}
        onSave={(billDiscount, note) => update(() => ({ billDiscount, note }))}
      />
      <ReceiptDialog
        receipt={receipt}
        justSaved={justSaved}
        onClose={() => { setReceipt(null); setJustSaved(false); setTimeout(() => searchRef.current?.focus(), 50); }}
        company={boot?.company}
        settings={settings}
        symbol={symbol}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function BillPanel({
  bill, computed, selected, setSelected, setLine, removeLine, discountAllowed, priceAllowed, maxDiscount, overDiscount, needsPrice,
  symbol, customerLabel, onCustomer, onDiscount, onHold, onRecall, heldCount, onClear, onPay, canPay, itemCount, onCloseSheet, stockMode, allowCreditBtn,
}) {
  const listRef = useRef(null);
  useEffect(() => {
    if (selected < 0) return;
    listRef.current?.querySelector(`[data-line="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <button type="button" onClick={onCustomer} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-border px-3 text-left hover:border-primary/40">
          <UserRound className="h-5 w-5 flex-shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] uppercase tracking-wide text-muted-foreground">Customer {bill.customer?.acno ? `· ${bill.customer.acno}` : ""}</span>
            <span className="block truncate text-sm font-semibold">{customerLabel}</span>
          </span>
          <Kbd>F3</Kbd>
        </button>
        <button type="button" onClick={onCloseSheet} aria-label="Close bill" className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden">
          <ChevronDown className="h-5 w-5" />
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {!bill.lines.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <Receipt className="h-10 w-10 opacity-30" />
            <p className="text-sm font-medium">The bill is empty</p>
            <p className="text-[12px]">Tap an item, search, or scan a barcode.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {bill.lines.map((l, i) => {
              const row = computed.lines[i] || {};
              const open = selected === i;
              const short = stockMode !== "off" && l.stock != null && Number(l.qty) > Number(l.stock);
              const noPrice = !(Number(l.rate) > 0);
              return (
                <li key={l.key} data-line={i} className={`${open ? "bg-primary/[0.04]" : ""}`}>
                  <button type="button" onClick={() => setSelected(open ? -1 : i)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left sm:px-4">
                    <span className={`mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-[12px] font-bold tabular-nums ${open ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>{fmtQty(l.qty)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">{l.name}</span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {noPrice ? <span className="font-semibold text-destructive">Type the price</span> : <>{fmt(l.rate)} {l.unit ? `/ ${l.unit}` : ""}</>}
                        {row.discount > 0 && <span className="ml-1 text-emerald-700">− {fmt(row.discount)}</span>}
                        {l.note && <span className="ml-1 italic">· {l.note}</span>}
                      </span>
                      {short && <span className="block text-[11px] font-medium text-amber-700">Only {fmtQty(l.stock)} in stock</span>}
                    </span>
                    <span className="text-[14px] font-bold tabular-nums">{fmt(row.net)}</span>
                  </button>
                  {open && (
                    <div className="space-y-2 px-3 pb-3 sm:px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-lg border border-border">
                          <button type="button" aria-label="Less" className="flex h-10 w-10 items-center justify-center hover:bg-muted" onClick={() => Number(l.qty) > 1 && setLine(i, { qty: round2(Number(l.qty) - 1) })}><Minus className="h-4 w-4" /></button>
                          <input
                            type="number" inputMode="decimal" min="0" step="any" aria-label="Quantity"
                            value={l.qty}
                            onChange={(e) => setLine(i, { qty: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) })}
                            onBlur={() => !(Number(l.qty) > 0) && setLine(i, { qty: 1 })}
                            className="h-10 w-16 border-x border-border bg-background text-center text-sm font-semibold tabular-nums focus:outline-none"
                          />
                          <button type="button" aria-label="More" className="flex h-10 w-10 items-center justify-center hover:bg-muted" onClick={() => setLine(i, { qty: round2(Number(l.qty) + 1) })}><Plus className="h-4 w-4" /></button>
                        </div>
                        {(priceAllowed || !(l.listPrice > 0)) && (
                          <label className="flex flex-1 items-center gap-1 rounded-lg border border-border px-2">
                            <span className="text-[11px] text-muted-foreground">Price</span>
                            <input type="number" inputMode="decimal" min="0" step="0.01" value={l.rate} aria-label="Price"
                              onChange={(e) => setLine(i, { rate: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) })}
                              className={`h-10 w-full bg-transparent text-right text-sm font-semibold tabular-nums focus:outline-none ${noPrice ? "text-destructive" : ""}`} />
                          </label>
                        )}
                        {discountAllowed && (
                          <label className="flex w-24 items-center gap-1 rounded-lg border border-border px-2">
                            <Percent className="h-3.5 w-3.5 text-muted-foreground" />
                            <input type="number" inputMode="decimal" min="0" max={maxDiscount} step="0.5" value={l.discountPct || ""} placeholder="0" aria-label="Line discount %"
                              onChange={(e) => setLine(i, { discountPct: e.target.value === "" ? 0 : Math.min(100, Math.max(0, Number(e.target.value))) })}
                              className="h-10 w-full bg-transparent text-right text-sm font-semibold tabular-nums focus:outline-none" />
                          </label>
                        )}
                        <button type="button" aria-label="Remove line" onClick={() => removeLine(i)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <label className="flex items-center gap-2 rounded-lg border border-border px-2">
                        <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                        <input type="text" value={l.note || ""} maxLength={200} placeholder="Line note (printed on the receipt)" aria-label="Line note"
                          onChange={(e) => setLine(i, { note: e.target.value })} className="h-9 w-full bg-transparent text-[13px] focus:outline-none" />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border bg-muted/30 px-3 pb-3 pt-2 sm:px-4">
        <dl className="space-y-0.5 text-[13px]">
          <div className="flex justify-between"><dt className="text-muted-foreground">Items</dt><dd className="tabular-nums">{fmtQty(itemCount)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{fmt(computed.subtotal)}</dd></div>
          {computed.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount</dt><dd className="tabular-nums">− {fmt(computed.discount)}</dd></div>}
          {computed.tax > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd className="tabular-nums">{fmt(computed.tax)}</dd></div>}
          {computed.rounding !== 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Round off</dt><dd className="tabular-nums">{fmt(computed.rounding)}</dd></div>}
        </dl>
        <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-border pt-1.5">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-[26px] font-extrabold tabular-nums text-primary">{symbol ? <span className="mr-1 text-sm font-semibold text-muted-foreground">{symbol}</span> : null}{fmt(computed.total)}</span>
        </div>
        {overDiscount && <p className="mt-1 text-[12px] font-medium text-destructive">A discount is above the {maxDiscount}% allowed.</p>}
        {needsPrice && <p className="mt-1 text-[12px] font-medium text-destructive">Type the price of the items marked red.</p>}

        <div className="mt-2 grid grid-cols-4 gap-1.5">
          <TileButton onClick={onHold} label="Hold" k="F6" icon={Pause} />
          <TileButton onClick={onRecall} label="Recall" k="F7" icon={Play} badge={heldCount} />
          <TileButton onClick={onDiscount} label="Discount" k="F4" icon={Percent} disabled={!discountAllowed} active={bill.billDiscount?.value > 0} />
          <TileButton onClick={onClear} label="Clear" icon={X} disabled={!bill.lines.length} />
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
          <Button className="h-14 text-lg font-extrabold" disabled={!canPay} onClick={() => onPay("CASH")}>
            Pay {fmt(computed.total)} <Kbd className="ml-2 text-primary-foreground">F9</Kbd>
          </Button>
          <Button variant="outline" className="h-14 px-3 text-[13px] font-semibold" disabled={!canPay} onClick={() => onPay(allowCreditBtn && bill.customer?.acno ? "CREDIT" : "CARD")}>
            {allowCreditBtn && bill.customer?.acno ? "Account" : "Card"} <Kbd className="ml-1.5">{allowCreditBtn && bill.customer?.acno ? "F9" : "F10"}</Kbd>
          </Button>
        </div>
      </div>
    </>
  );
}

function TileButton({ onClick, label, k, icon: Icon, disabled, badge, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg border bg-background text-[11.5px] font-semibold transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40 ${active ? "border-primary text-primary" : "border-border"}`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {k && <span className="absolute right-1 top-0.5 text-[9px] font-mono text-muted-foreground">{k}</span>}
      {badge > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{badge}</span>}
    </button>
  );
}

function BillDiscountDialog({ open, onOpenChange, value, note, max, onSave }) {
  const [type, setType] = useState("pct");
  const [v, setV] = useState("");
  const [n, setN] = useState("");
  useEffect(() => {
    if (!open) return;
    setType(value?.type || "pct");
    setV(value?.value ? String(value.value) : "");
    setN(note || "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const save = () => { onSave({ type, value: Math.max(0, Number(v) || 0) }, n); onOpenChange(false); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Bill discount">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative w-full max-w-sm rounded-2xl bg-background p-5 shadow-2xl" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") onOpenChange(false); }}>
        <h2 className="text-lg font-bold">Bill discount</h2>
        <p className="text-[12.5px] text-muted-foreground">Shared over the lines by value. Largest allowed: {max}%.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[{ id: "pct", label: "Percent %" }, { id: "amt", label: "Amount" }].map((o) => (
            <button key={o.id} type="button" onClick={() => setType(o.id)} className={`h-10 rounded-lg border text-sm font-semibold ${type === o.id ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>{o.label}</button>
          ))}
        </div>
        <input autoFocus type="number" inputMode="decimal" min="0" step="0.01" value={v} onChange={(e) => setV(e.target.value)} placeholder="0"
          className="mt-3 h-12 w-full rounded-lg border border-input bg-background px-3 text-right text-xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <input type="text" value={n} onChange={(e) => setN(e.target.value)} maxLength={250} placeholder="Bill note (optional)"
          className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => { onSave({ type, value: 0 }, n); onOpenChange(false); }}>Remove</Button>
          <Button className="flex-1" onClick={save}>Apply <Kbd className="ml-2 text-primary-foreground">Enter</Kbd></Button>
        </div>
      </div>
    </div>
  );
}
