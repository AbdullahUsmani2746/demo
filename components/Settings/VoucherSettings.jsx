"use client";
import React, { useState, useEffect } from "react";
import Select from "react-select";
import { Save, Search, CheckCircle2, Receipt } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { selectStyles } from "@/components/shared/EntityFormPanel";

// System select look + maroon chips for the picked MACNOs.
const macnoSelectStyles = {
  ...selectStyles(false),
  multiValue: (base) => ({
    ...base,
    backgroundColor: "hsl(var(--primary) / 0.1)",
    borderRadius: 6,
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: "hsl(var(--primary))",
    fontWeight: 500,
    fontSize: 12.5,
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: "hsl(var(--primary))",
    borderRadius: "0 6px 6px 0",
    ":hover": {
      backgroundColor: "hsl(var(--primary) / 0.18)",
      color: "hsl(var(--primary))",
    },
  }),
};

const VoucherSettings = () => {
  const {
    getVoucherSettings,
    updateSetting,
    loading: settingsLoading,
  } = useSettings();
  const [localSettings, setLocalSettings] = useState({});
  const [changedFields, setChangedFields] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [savedFields, setSavedFields] = useState(new Set());

  const voucherSettings = getVoucherSettings();

  // TanStack Query for fetching MACNO options
  const {
    data: macnoOptions = [],
    isLoading: loadingMacno,
    error: macnoError,
  } = useQuery({
    queryKey: ["macnoOptions"],
    queryFn: async () => {
      const response = await axios.get("/api/accounts/macno");
      if (response.data.status === 200) {
        return response.data.data.map((item) => ({
          label: item.macname,
          value: item.macno,
        }));
      }
      throw new Error("Failed to fetch MACNO");
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    if (voucherSettings.length === 0) return;

    const initial = {};
    voucherSettings.forEach((setting) => {
      initial[setting.id] = {
        macnoValue: setting.macnoValue || [],
        exclude: setting.exclude || false,
      };
    });
    setLocalSettings(initial);
  }, [voucherSettings.length]);

  const handleSelectChange = (settingId, selectedOptions) => {
    const selectedValues = selectedOptions
      ? selectedOptions.map((opt) => opt.value)
      : [];

    setLocalSettings((prev) => ({
      ...prev,
      [settingId]: {
        ...prev[settingId],
        macnoValue: selectedValues,
      },
    }));

    setChangedFields((prev) => new Set([...prev, settingId]));
    setSavedFields((prev) => {
      const newSet = new Set(prev);
      newSet.delete(settingId);
      return newSet;
    });
  };

  const handleExcludeChange = (settingId, checked) => {
    setLocalSettings((prev) => ({
      ...prev,
      [settingId]: {
        ...prev[settingId],
        exclude: checked,
      },
    }));

    setChangedFields((prev) => new Set([...prev, settingId]));
    setSavedFields((prev) => {
      const newSet = new Set(prev);
      newSet.delete(settingId);
      return newSet;
    });
  };

  const handleSave = async (setting) => {
    const data = localSettings[setting.id];

    const result = await updateSetting({
      id: setting.id,
      key: setting.key,
      description: setting.description,
      macnoValue: data.macnoValue || [],
      exclude: data.exclude || false,
    });

    if (result.success) {
      setChangedFields((prev) => {
        const newSet = new Set(prev);
        newSet.delete(setting.id);
        return newSet;
      });

      setSavedFields((prev) => new Set([...prev, setting.id]));

      setTimeout(() => {
        setSavedFields((prev) => {
          const newSet = new Set(prev);
          newSet.delete(setting.id);
          return newSet;
        });
      }, 2000);
    }
  };

  const filteredSettings = voucherSettings.filter(
    (setting) =>
      setting.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      setting.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getSelectedValue = (settingId) => {
    const data = localSettings[settingId];
    if (!data) return [];

    const values = data.macnoValue || [];
    return macnoOptions.filter((opt) => values.includes(opt.value));
  };

  return (
    <div className="space-y-4">
      {/* Header + search */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <Receipt className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Voucher Settings</h2>
            <p className="text-xs text-muted-foreground">Which main accounts (MACNO) each voucher type offers</p>
          </div>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by name or key..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-10 pl-9"
          />
        </div>
      </div>

      {macnoError && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          Could not load the MACNO list.
        </p>
      )}

      {/* Settings grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filteredSettings.map((setting) => {
          const hasChanges = changedFields.has(setting.id);
          const isSaved = savedFields.has(setting.id);

          return (
            <div
              key={setting.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-background"
            >
              {/* Card header */}
              <div className="flex items-start justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold leading-tight text-primary">
                    {setting.description || setting.key}
                  </h3>
                  <span className="mt-1 inline-block break-all font-mono text-[11px] text-muted-foreground">
                    {setting.key}
                  </span>
                </div>
                {isSaved ? (
                  <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-[#edf2ee] px-2.5 py-1 text-xs font-semibold text-[#2f5139]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Saved
                  </span>
                ) : (
                  hasChanges && (
                    <Button
                      size="sm"
                      onClick={() => handleSave(setting)}
                      disabled={settingsLoading}
                      className="h-8 flex-shrink-0 gap-1.5"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save
                    </Button>
                  )
                )}
              </div>

              <div className="space-y-4 p-4">
                {/* Exclude switch */}
                <label
                  htmlFor={`exclude-${setting.id}`}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">Exclude mode</span>
                    <span className="block text-xs text-muted-foreground">
                      Offer every account except the selected MACNOs
                    </span>
                  </span>
                  <Switch
                    id={`exclude-${setting.id}`}
                    checked={localSettings[setting.id]?.exclude || false}
                    onCheckedChange={(checked) => handleExcludeChange(setting.id, checked)}
                  />
                </label>

                {/* MACNO select */}
                <div>
                  <label
                    htmlFor={`macno-${setting.id}`}
                    className="mb-1 block text-[12.5px] font-semibold text-foreground/80"
                  >
                    MACNO(s)
                  </label>
                  <Select
                    inputId={`macno-${setting.id}`}
                    options={macnoOptions}
                    value={getSelectedValue(setting.id)}
                    onChange={(selected) =>
                      handleSelectChange(setting.id, selected)
                    }
                    isMulti
                    isClearable
                    isDisabled={loadingMacno}
                    isLoading={loadingMacno}
                    placeholder={
                      loadingMacno
                        ? "Loading..."
                        : "Select MACNOs..."
                    }
                    noOptionsMessage={() => "Nothing found"}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                    menuPlacement="auto"
                    styles={macnoSelectStyles}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {filteredSettings.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
          <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">
            No settings found matching your search
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try adjusting your search terms
          </p>
        </div>
      )}
    </div>
  );
};

export default VoucherSettings;
