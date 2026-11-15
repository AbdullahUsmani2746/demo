"use client";
import axios from "axios";
import { createContext, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

const SettingsContext = createContext();

export const SettingsProvider = ({ children }) => {
  const queryClient = useQueryClient();
  // /api/* is behind auth middleware. On the sign-in page the request is
  // redirected and the query lands in an error state that never refetches
  // (this provider lives in the root layout and never remounts). Gate on the
  // session so the fetch fires as soon as login completes.
  const { status: sessionStatus } = useSession();

  // TanStack Query: Fetch settings
  const {
    data: settings = [],
    isLoading: loading,
    error,
    refetch: fetchSettings,
  } = useQuery({
    queryKey: ["settings"],
    enabled: sessionStatus === "authenticated",
    queryFn: async () => {
      const response = await axios.get("/api/settings");
      if (response.data.status === 200) {
        return response.data.data || [];
      }
      throw new Error("Failed to fetch settings");
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });

  // TanStack Query: Update setting
  const updateSettingMutation = useMutation({
    mutationFn: async (settingData) => {
      const method = settingData.id ? "PUT" : "POST";
      const response = await fetch("/api/settings", {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settingData),
      });

      if (response.status === 200 || response.status === 201) {
        return await response.json();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update setting");
      }
    },
    onSuccess: () => {
      // Invalidate and refetch settings
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => {
      console.error("Settings update error:", error);
    },
  });

  // Get setting value by key
  const getSetting = (key, defaultValue = "") => {
    const setting = settings.find((s) => s.key === key);
    return setting ? setting.value : defaultValue;
  };

  // Get setting object by key (full object with exclude, value, etc.)
  const getSettingObject = (key) => {
    return settings.find((s) => s.key === key);
  };

  // Get settings by pattern
  const getSettingsByPattern = (pattern) => {
    return settings.filter((s) => s.key.includes(pattern));
  };

  // Get all settings (for voucher/currency settings page)
  const getVoucherSettings = () => {
    return settings;
  };

  // Parse MACNO value from setting value string
  // Handles: "macno=27" or "excludeMacno=003,004"
  const parseMacnoValue = (value) => {
    if (!value) return null;

    const match = value.match(/macno=(.+)/i);
    if (match) {
      return match[1]; // Returns "27" or "003,004"
    }
    return null;
  };

  // Get MACNO value for a specific key
  const getMacnoForKey = (key) => {
    const setting = getSettingObject(key);
    if (!setting) return null;

    return parseMacnoValue(setting.value);
  };

  // Get excluded MACNO values as array for a specific key
  const getExcludedMacnoForKey = (key) => {
    const setting = getSettingObject(key);
    if (!setting || !setting.exclude) return [];

    const macnoValue = parseMacnoValue(setting.value);
    if (!macnoValue) return [];

    // Split by comma and trim
    return macnoValue
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  };

  // Get all excluded MACNOs from all settings
  const getAllExcludedMacno = () => {
    const excludedSettings = settings.filter((s) => s.exclude === true);
    const allExcluded = [];

    excludedSettings.forEach((setting) => {
      const macnoValue = parseMacnoValue(setting.value);
      if (macnoValue) {
        const values = macnoValue
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        allExcluded.push(...values);
      }
    });

    // Return unique values
    return [...new Set(allExcluded)];
  };

  // Get MACNO for specific voucher type
  // Example: getMacnoForVoucher('paymentMaster') => '27'
  const getMacnoForVoucher = (voucherType) => {
    return getMacnoForKey(voucherType);
  };

  // Check if a MACNO should be excluded for a specific voucher type
  const isMacnoExcluded = (voucherType, macno) => {
    const excludedMacnos = getExcludedMacnoForKey(voucherType);
    return excludedMacnos.includes(macno.toString().padStart(3, "0"));
  };

  // Update setting wrapper function
  const updateSetting = async (settingData) => {
    try {
      await updateSettingMutation.mutateAsync(settingData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  // Set error function
  const setError = (errorMessage) => {
    console.error("Settings error:", errorMessage);
  };

  return (
    <SettingsContext.Provider
      value={{
        settings,
        loading,
        error,
        fetchSettings,
        getSetting,
        getSettingObject,
        getSettingsByPattern,
        getVoucherSettings,
        parseMacnoValue,
        getMacnoForKey,
        getMacnoForVoucher,
        getExcludedMacnoForKey,
        getAllExcludedMacno,
        isMacnoExcluded,
        updateSetting,
        setError,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
};