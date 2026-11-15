// hooks/useGrandMasterBOM.js
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const fetchAllBOMs = async () => {
  try {
    // Fetch all BOMs without pagination
    const response = await axios.get('/api/manufacturing/bom/', {
      params: {
        page: 1,
        limit: 100000, // or use a very high number like 10000
        sortBy: 'id',
        sortOrder: 'asc'
      }
    });
    return response.data?.data || [];
  } catch (error) {
    console.error('Error fetching all BOMs:', error);
    return [];
  }
};

const fetchAllItems = async () => {
  try {
    const response = await axios.get("/api/setup/items");
    return response.data?.data || [];
  } catch (error) {
    console.error('Error fetching items:', error);
    return [];
  }
};

export const useGrandMasterBOM = () => {
  // Fetch all BOMs (not paginated)
  const { 
    data: bomItems, 
    isLoading: bomLoading,
    error: bomError,
    refetch: refetchBOMs
  } = useQuery({
    queryKey: ['grandMasterBOMs'],
    queryFn: fetchAllBOMs,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Fetch all items
  const {
    data: items,
    isLoading: itemsLoading,
    error: itemsError
  } = useQuery({
    queryKey: ['grandMasterItems'],
    queryFn: fetchAllItems,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    bomItems: bomItems || [],
    items: items || [],
    loading: bomLoading || itemsLoading,
    error: bomError || itemsError,
    refetch: refetchBOMs
  };
};