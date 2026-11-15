"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const SOURCES = {
    departments: "/api/setup/departments",
    designations: "/api/setup/designations",
    cities: "/api/setup/cities",
    branches: "/api/setup/branches",
    banks: "/api/setup/banks",
    bankBranches: "/api/setup/bank_branches",
    employeeTypes: "/api/setup/employee_types",
    employeeCategories: "/api/setup/employee_categories",
    workLocations: "/api/setup/work_locations",
    costCenters: "/api/setup/cost_centers",
    allowances: "/api/setup/allowances",
    deductions: "/api/setup/deductions",
    leaves: "/api/setup/leaves",
    managers: "/api/setup/managers",
};

// Fetches every dropdown/multi-select data source the Employee form needs,
// in parallel, once per modal open — mirrors the pattern in DynamicEntity.jsx.
export function useEmployeeLookups(enabled = true) {
    return useQuery({
        queryKey: ["employee-lookups"],
        enabled,
        queryFn: async () => {
            const entries = Object.entries(SOURCES);
            const results = await Promise.all(
                entries.map(async ([key, url]) => {
                    try {
                        const res = await axios.get(url);
                        return [key, res.data?.data || res.data || []];
                    } catch (err) {
                        console.error(`Error fetching ${key}:`, err);
                        return [key, []];
                    }
                })
            );
            return Object.fromEntries(results);
        },
        staleTime: 60 * 1000,
    });
}
