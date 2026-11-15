"use client";

// Sale Order line → Production Plan (field type "saleOrderPlan" in
// VOUCHER_CONFIG.saleOrder, Features: saleOrder.planFromOrder). Two cells:
//   part "date": Plan Date (today or later) + the plan no(s) under it
//   part "qty" : Plan Qty (not more than the line's Qty (KG)) + Create
// Optional. On a saved order Create adds the line to the dispatch plan of its
// Plan Date at once (/api/orders/saleOrder/plan). On a new order Create only
// marks the line: the server plans it when the order is saved — or, when the
// order waits for approval, once it is approved (lib/orders/soPlan.js).
// An item is planned from its order once; the server checks everything again.

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

const PLAN_API = "/api/orders/saleOrder/plan";

const p2 = (n) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
const valOf = (v) => (v && typeof v === "object" ? v.value : v);
const isSet = (v) => v !== undefined && v !== null && v !== "";
const fmtDay = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "";

// One request per Sale Order for the plan lines already made
const plansCache = new Map();
const loadPlans = (soNo) => {
  if (!plansCache.has(soNo)) {
    plansCache.set(
      soNo,
      axios
        .get(`${PLAN_API}?so_no=${soNo}`)
        .then((r) => r.data?.data || [])
        .catch(() => {
          plansCache.delete(soNo);
          return [];
        }),
    );
  }
  return plansCache.get(soNo);
};

// What the cells show and Create sends: what the user typed, else the plan
// already made for this item (then "Planned"), else today + the line's Qty (KG).
function planValues(line, existing) {
  const dateSet = isSet(line?.plan_date);
  const qtySet = isSet(line?.plan_qty);
  return {
    date: existing ? String(existing.dated).slice(0, 10) : dateSet ? String(line.plan_date).slice(0, 10) : today(),
    qty: existing ? existing.qty : qtySet ? line.plan_qty : line?.qty ?? "",
    planned: Boolean(existing),
  };
}

function soPlanError(line, vals) {
  if (!valOf(line?.itcd)) return "Select the product first";
  if (!vals.date) return "Select a Plan Date";
  if (vals.date < today()) return "Plan Date cannot be before today";
  const planQty = Number(vals.qty);
  if (!(planQty > 0)) return "Enter the Plan Qty";
  const qty = Number(line?.qty) || 0;
  if (planQty > qty) return `Plan Qty cannot be more than the order qty (${qty})`;
  return null;
}

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60";

export default function SaleOrderPlanCell({ part, line, masterData, editMode, locked, setValue }) {
  // Only a saved order has its real no (create may show a preview no)
  const soNo = editMode ? Number(valOf(masterData?.order_no)) || null : null;
  const itcd = Number(valOf(line?.itcd)) || null;
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!soNo || !itcd) {
      setPlans([]);
      return;
    }
    let alive = true;
    loadPlans(soNo).then((rows) => alive && setPlans(rows.filter((r) => Number(r.itcd) === itcd)));
    return () => {
      alive = false;
    };
  }, [soNo, itcd, line?.plan_no]);

  const vals = planValues(line, plans[0]);
  const fixed = locked || vals.planned;

  // Typing a new date / qty un-marks a line marked on a new Sale Order
  const edit = (name, v) => {
    setValue(name, v);
    if (line?.plan_pending) setValue("plan_pending", false);
  };

  if (part === "date") {
    return (
      <div className="min-w-[150px]">
        <input
          type="date"
          className={inputCls}
          min={today()}
          value={vals.date}
          disabled={fixed}
          onChange={(e) => edit("plan_date", e.target.value)}
        />
        {plans.length > 0 && (
          <div className="mt-1 text-[11px] font-semibold text-emerald-700">
            {plans.map((p) => `Plan #${p.tran_id}${p.dated ? ` (${fmtDay(p.dated)})` : ""}${p.nature ? ` · ${p.nature}` : ""}`).join(", ")}
          </div>
        )}
        {!plans.length && line?.plan_pending && (
          <div className="mt-1 text-[11px] font-semibold text-amber-600">Planned on save</div>
        )}
      </div>
    );
  }

  const create = async () => {
    if (sendingRef.current) return;
    const err = soPlanError(line, vals);
    if (err) {
      toast.error(err);
      return;
    }
    // New Sale Order: no order no yet — the server plans the marked line on save
    if (!soNo) {
      setValue("plan_date", vals.date);
      setValue("plan_qty", vals.qty);
      setValue("plan_pending", true);
      toast.success("The production plan line is made when the Sale Order is saved (or approved)");
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    try {
      const res = await axios.post(PLAN_API, { so_no: soNo, lines: [{ itcd, plan_date: vals.date, plan_qty: vals.qty }] });
      plansCache.delete(soNo);
      setValue("plan_no", res.data?.tran_id || null);
      toast.success(res.data?.message || "Added to production plan");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };

  const label = busy ? "…" : vals.planned ? "Planned" : line?.plan_pending ? "Marked" : "Create";

  return (
    <div className="flex min-w-[170px] items-center gap-1">
      <input
        type="number"
        className={inputCls}
        min={0}
        max={Number(line?.qty) || undefined}
        placeholder="Plan Qty"
        value={vals.qty}
        disabled={fixed}
        onChange={(e) => edit("plan_qty", e.target.value)}
      />
      {!locked && (
        <button
          type="button"
          onClick={create}
          disabled={busy || Boolean(line?.plan_pending) || vals.planned}
          className="h-9 shrink-0 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {label}
        </button>
      )}
    </div>
  );
}
