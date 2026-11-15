"use client";
import axios from "axios";
import { createContext, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

const CurrencyContext = createContext();

export const CurrencyProvider = ({ children }) => {
  const queryClient = useQueryClient();
  // /api/* is behind auth middleware. On the sign-in page the request is
  // redirected and the query lands in an error state that never refetches
  // (this provider lives in the root layout and never remounts). Gate on the
  // session so the fetch fires as soon as login completes.
  const { status: sessionStatus } = useSession();

  // TanStack Query: Fetch currency settings
  const {
    data: currencyData,
    isLoading: loading,
    error,
    refetch: fetchCurrency,
  } = useQuery({
    queryKey: ["currency"],
    enabled: sessionStatus === "authenticated",
    queryFn: async () => {
      const response = await axios.get("/api/settings/currency");
      
      if (response.data.status === 200) {
        const data = response.data.data;
        return {
          currency: {
            code: data.defaultCurrency,
            symbol: data.currencySymbol,
            name: data.currencyName,
          },
          availableCurrencies: data.availableCurrencies || [],
        };
      }
      throw new Error("Failed to fetch currency data");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // TanStack Query: Update currency
  const updateCurrencyMutation = useMutation({
    mutationFn: async (currencyCode) => {
      const response = await axios.put("/api/settings/currency", {
        currencyCode,
      });

      if (response.data.status === 200) {
        return response.data.data.currency;
      }
      throw new Error("Failed to update currency");
    },
    onSuccess: (newCurrency) => {
      // Update the cache
      queryClient.setQueryData(["currency"], (oldData) => ({
        ...oldData,
        currency: {
          code: newCurrency.code,
          symbol: newCurrency.symbol,
          name: newCurrency.name,
        },
      }));
      
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ["currency"] });
    },
    onError: (error) => {
      console.error("Currency update error:", error);
    },
  });

  // Extract data from query
  const currency = currencyData?.currency || {
    code: "PKR",
    symbol: "PKR",
    name: "Pakistani Rupee",
  };
  
  const availableCurrencies = currencyData?.availableCurrencies || [];

  // Update currency wrapper function
  const updateCurrency = async (currencyCode) => {
    try {
      await updateCurrencyMutation.mutateAsync(currencyCode);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  // Format amount with current currency
  const formatAmount = (amount, showSymbol = true) => {
    const numAmount = parseFloat(amount) || 0;
    const formatted = numAmount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return showSymbol ? `${currency.symbol} ${formatted}` : formatted;
  };

  // Get currency symbol
  const getCurrencySymbol = () => {
    return currency.symbol;
  };

  // Get currency code
  const getCurrencyCode = () => {
    return currency.code;
  };

  // Get currency name
  const getCurrencyName = () => {
    return currency.name;
  };

  // Parse amount (remove symbols and convert to number)
  const parseAmount = (amountString) => {
    if (typeof amountString === "number") return amountString;
    
    const cleanedString = amountString
      .replace(currency.symbol, "")
      .replace(/,/g, "")
      .trim();
    
    return parseFloat(cleanedString) || 0;
  };

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        availableCurrencies,
        loading,
        error,
        fetchCurrency,
        updateCurrency,
        formatAmount,
        getCurrencySymbol,
        getCurrencyCode,
        getCurrencyName,
        parseAmount,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return context;
};