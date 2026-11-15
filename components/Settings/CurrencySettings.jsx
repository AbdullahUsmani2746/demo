"use client";
import React, { useState, useEffect } from "react";
import { useCurrency } from "@/context/CurrencyContext";
import { Check, Save, RefreshCw, Coins, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

const CurrencySettings = () => {
  const {
    currency,
    availableCurrencies,
    loading,
    updateCurrency,
    formatAmount,
  } = useCurrency();

  const [selectedCurrency, setSelectedCurrency] = useState(currency.code);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Update selected currency when currency changes
  useEffect(() => {
    setSelectedCurrency(currency.code);
  }, [currency.code]);

  const hasChanges = selectedCurrency !== currency.code;

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);

    const result = await updateCurrency(selectedCurrency);

    if (result.success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }

    setSaving(false);
  };

  const handleReset = () => {
    setSelectedCurrency(currency.code);
  };

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <Coins className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Currency</h2>
            <p className="text-xs text-muted-foreground">The currency every amount, PDF and report is shown in</p>
          </div>
        </div>
        {hasChanges && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={saving}
              className="h-10 gap-2 bg-background"
            >
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
            <Button onClick={handleSave} disabled={saving} className="h-10 gap-2">
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Current currency */}
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="border-b border-primary/15 bg-primary/5 px-4 py-3">
          <h3 className="text-[15px] font-semibold text-primary">Current currency</h3>
          <p className="text-xs text-muted-foreground">In use across the application</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-primary">{currency.symbol}</span>
              <span className="text-xl font-semibold text-foreground">{currency.code}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{currency.name}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Example</p>
            <p className="text-xl font-bold text-foreground">{formatAmount(1234.56)}</p>
          </div>
        </div>
      </div>

      {/* Success message */}
      {saveSuccess && (
        <div className="flex items-center gap-3 rounded-lg bg-[#edf2ee] px-4 py-3 text-[#2f5139] animate-in fade-in slide-in-from-top-2">
          <Check className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm font-medium">Currency updated successfully!</p>
        </div>
      )}

      {/* Currency grid */}
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-primary">Choose a currency</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {availableCurrencies.map((curr) => {
            const isSelected = selectedCurrency === curr.code;
            const isCurrent = currency.code === curr.code;

            return (
              <button
                key={curr.code}
                type="button"
                onClick={() => setSelectedCurrency(curr.code)}
                disabled={loading || saving}
                aria-pressed={isSelected}
                className={`relative rounded-xl border p-4 text-left transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-background hover:border-primary/40 hover:bg-primary/[0.03]"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-xl font-bold ${
                        isSelected
                          ? "bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20"
                          : "bg-muted text-foreground/70"
                      }`}
                    >
                      {curr.symbol}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-bold text-foreground">{curr.code}</p>
                        {isCurrent && (
                          <span className="rounded-full bg-[#edf2ee] px-2 py-0.5 text-xs font-semibold text-[#2f5139]">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{curr.name}</p>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary">
                      <Check className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                </div>

                <div className="border-t border-border pt-3">
                  <p className="mb-0.5 text-xs text-muted-foreground">Example</p>
                  <p className="text-base font-semibold text-foreground">
                    {curr.symbol} 1,234.56
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div className="py-8 text-center">
          <RefreshCw className="mx-auto mb-3 h-7 w-7 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading currencies...</p>
        </div>
      )}

      {/* Info box */}
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
          <Info className="h-4 w-4" />
          Good to know
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Currency changes will apply globally across the application</li>
          <li>All amounts will be displayed in the selected currency</li>
          <li>PDFs and reports will use the selected currency symbol</li>
          <li>Existing data will not be converted automatically</li>
        </ul>
      </div>
    </div>
  );
};

export default CurrencySettings;
