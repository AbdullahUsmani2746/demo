// hooks/useBOMOptimized.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const bomAPI = {
  getAll: (params) => axios.get('/api/manufacturing/bom/', { params }),
  create: (data) => axios.post('/api/manufacturing/bom', data),
  update: (id, data) => axios.put(`/api/manufacturing/bom/${id}`, data),
  validate: (params) => axios.get('/api/manufacturing/bom/validation/', { params }),
};

// Separate function to fetch items for dropdowns
const fetchItems = async () => {
  try {
    const response = await axios.get("/api/setup/items");
    return response.data?.data || [];
  } catch (error) {
    console.error('Error fetching items:', error);
    return [];
  }
};



export const useBOM = (params = {}) => {
  const queryClient = useQueryClient();
  
  const queryKey = ['boms', params];

  // Optimized data fetching with caching
  const { 
    data, 
    error, 
    isLoading,
    isFetching,
    refetch  // ← Add this to manually trigger refetch

  } = useQuery({
    queryKey,
    queryFn: () => bomAPI.getAll(params).then(res => res.data),
    staleTime: 2 * 60 * 1000, // 2 minutes cache
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
  });

  // Fetch items separately for dropdowns
  const {
    data: itemsData,
    isLoading: itemsLoading,
    error: itemsError
  } = useQuery({
    queryKey: ['items'],
    queryFn: fetchItems,
    staleTime: 5 * 60 * 1000, // 5 minutes cache for items
    gcTime: 15 * 60 * 1000, // 15 minutes garbage collection
  });

  // Optimized mutations
  const createMutation = useMutation({
    mutationFn: bomAPI.create,
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['boms'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => bomAPI.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boms'] });
    },
  });

  const validateMutation = useMutation({
    mutationFn: (validationParams) => bomAPI.validate(validationParams),
  });

  return {
    // Data
    bomItems: data?.data || [],
    items: itemsData || [], // ← FIXED: Return items for dropdowns
    total: data?.total || 0,
    totalPages: data?.totalPages || 0,
    
    // Loading states
    loading: isLoading,
    fetching: isFetching,
    itemsLoading,
    error,
    
    // Actions
    createBOM: createMutation.mutateAsync,
    updateBOM: updateMutation.mutateAsync,
    validateBOM: validateMutation.mutateAsync,
    
    // Mutation states
    refetch, // ← Add this to return object

    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isValidating: validateMutation.isPending,
  };
};