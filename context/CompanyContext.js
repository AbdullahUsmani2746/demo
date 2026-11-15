"use client";
import axios from "axios";
import { createContext, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { DEFAULT_COMPANY_LOGO, companyShortName } from "@/lib/companyName";

const CompanyContext = createContext();

export const CompanyProvider = ({ children }) => {
  const queryClient = useQueryClient();
  // /api/* is behind auth middleware. On the sign-in page the request is
  // redirected and the query lands in an error state that never refetches
  // (this provider lives in the root layout and never remounts). Gate on the
  // session so the fetch fires as soon as login completes.
  const { status: sessionStatus } = useSession();

  // TanStack Query: Fetch company settings
  const {
    data: company,
    isLoading: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["company"],
    enabled: sessionStatus === "authenticated",
    queryFn: async () => {
      const response = await axios.get("/api/settings/company");

      if (response.data.status === 200) {
        const data = response.data.data;
        return {
          id: data.id,
          name: data.company,
          logo: data.logo || DEFAULT_COMPANY_LOGO,
          addr1: data.addr1 || "",
          addr2: data.addr2 || "",
          city: data.city || "",
          phone: data.phone || "",
          fax: data.fax || "",
          email: data.email || "",
          address: data.address || [],
        };
      }
      throw new Error("Failed to fetch company data");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (cache time)
    retry: 2,
  });

  // TanStack Query: Update company settings
  const updateCompanyMutation = useMutation({
    mutationFn: async (companyData) => {
      const response = await axios.put("/api/settings/company", companyData);

      if (response.data.status === 200) {
        return response.data.data;
      }
      throw new Error("Failed to update company");
    },
    onSuccess: (updatedData) => {
      // Update the cache with new data
      queryClient.setQueryData(["company"], {
        id: updatedData.id,
        name: updatedData.company,
        logo: updatedData.logo || DEFAULT_COMPANY_LOGO,
        addr1: updatedData.addr1 || "",
        addr2: updatedData.addr2 || "",
        city: updatedData.city || "",
        phone: updatedData.phone || "",
        fax: updatedData.fax || "",
        email: updatedData.email || "",
        address: [
          updatedData.addr1,
          updatedData.addr2,
          updatedData.city,
          updatedData.phone ? `Phone: ${updatedData.phone}` : "",
        ].filter(Boolean),
      });

      // Invalidate and refetch if needed
      queryClient.invalidateQueries({ queryKey: ["company"] });
    },
    onError: (error) => {
      console.error("Company update error:", error);
    },
  });

  // Get company name
  const getCompanyName = () => {
    return company?.name || "";
  };

  // Get company logo
  const getCompanyLogo = () => {
    return company?.logo || DEFAULT_COMPANY_LOGO;
  };

  // Get company address as array
  const getCompanyAddress = () => {
    return company?.address || [];
  };

  // Get full company details
  const getCompanyDetails = () => {
    return company || {};
  };

  // Update company wrapper function
  const updateCompany = async (companyData) => {
    try {
      await updateCompanyMutation.mutateAsync(companyData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  return (
    <CompanyContext.Provider
      value={{
        company: company || {
          id: null,
          name: "",
          logo: DEFAULT_COMPANY_LOGO,
          addr1: "",
          addr2: "",
          city: "",
          phone: "",
          fax: "",
          email: "",
          address: [],
        },
        loading,
        error,
        fetchCompany: refetch,
        updateCompany,
        // First word of the company name ("SMS"), for file names and short
        // labels. Neutral "Company" until the profile has loaded.
        shortName: companyShortName(company?.name),
        getCompanyName,
        getCompanyLogo,
        getCompanyAddress,
        getCompanyDetails,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error("useCompany must be used within CompanyProvider");
  }
  return context;
};
