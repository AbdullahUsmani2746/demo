// hooks/useMaterialUsageData.js
"use client";

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

// Function to fetch ALL BOMs without pagination
const fetchAllBOMs = async () => {
  try {
    const response = await axios.get('/api/manufacturing/bom/', {
      params: {
        page: 1,
        limit: 10000,
        sortBy: 'id',
        sortOrder: 'asc'
      }
    });
    
    if (response.data?.data) {
      return response.data.data;
    } else if (Array.isArray(response.data)) {
      return response.data;
    } else {
      console.warn("Unexpected BOM API response structure:", response.data);
      return [];
    }
  } catch (error) {
    console.error("Error fetching BOMs:", error);
    throw error;
  }
};

// Function to fetch ALL items
const fetchAllItems = async () => {
  try {
    const response = await axios.get("/api/setup/items");
    
    if (response.data?.data) {
      return response.data.data;
    } else if (Array.isArray(response.data)) {
      return response.data;
    } else {
      console.warn("Unexpected Items API response structure:", response.data);
      return [];
    }
  } catch (error) {
    console.error("Error fetching items:", error);
    throw error;
  }
};

export const useMaterialUsageData = () => {
  // Query for ALL BOMs
  const { 
    data: bomItems, 
    isLoading: bomLoading,
    error: bomError,
    refetch: refetchBOMs
  } = useQuery({
    queryKey: ['materialUsageBOMs'],
    queryFn: fetchAllBOMs,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });

  // Query for ALL items
  const {
    data: items,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems
  } = useQuery({
    queryKey: ['materialUsageItems'],
    queryFn: fetchAllItems,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });

  // Combined refetch function
  const refetchAll = async () => {
    await Promise.all([refetchBOMs(), refetchItems()]);
  };

  return {
    // Data
    bomItems: bomItems || [],
    items: items || [],
    
    // Loading states
    loading: bomLoading || itemsLoading,
    bomLoading,
    itemsLoading,
    
    // Errors
    error: bomError || itemsError,
    bomError,
    itemsError,
    
    // Actions
    refetch: refetchAll,
    refetchBOMs,
    refetchItems
  };
};