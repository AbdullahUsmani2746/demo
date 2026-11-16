"use client";
// Shared bits of the POS screens: the till bootstrap (one call), money format,
// API error text, and the keyboard-hint chip.
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/context/CurrencyContext";

export const POS_BOOT_KEY = ["pos", "bootstrap"];

export function usePosBoot() {
  return useQuery({
    queryKey: POS_BOOT_KEY,
    queryFn: async () => (await axios.get("/api/pos/bootstrap")).data,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export const fmt = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtQty = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });

// CurrencyProvider wraps every page (app/layout.js), so the hook is always
// inside it — called unconditionally, as hooks must be.
export function useMoney() {
  const symbol = useCurrency()?.currency?.symbol || "";
  return { symbol, money: (n) => `${symbol ? symbol + " " : ""}${fmt(n)}` };
}

/** Text of an API error (our routes answer { error }); network trouble said plainly. */
export function apiError(err, fallback = "Something went wrong.") {
  if (err?.response?.data?.error) return err.response.data.error;
  if (err?.response?.data?.message) return err.response.data.message;
  if (err?.code === "ERR_NETWORK" || err?.message === "Network Error") return "No connection to the server — nothing was saved. Check the network and try again.";
  if (err?.code === "ECONNABORTED") return "The server is slow to answer — try again (a retried sale is never posted twice).";
  return fallback;
}

export const newClientRef = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);

export function Kbd({ children, className = "" }) {
  return (
    <kbd className={`inline-flex min-w-[1.5rem] items-center justify-center rounded border border-current/25 bg-black/5 px-1 font-mono text-[10px] font-semibold leading-4 opacity-80 ${className}`}>
      {children}
    </kbd>
  );
}
