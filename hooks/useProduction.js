// hooks/useProductionOptimized.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const productionAPI = {
  getAll: (params) => axios.get('/api/manufacturing/production', { params }),
  create: (data) => axios.post('/api/manufacturing/production', data),
  update: (id, data) => axios.put(`/api/manufacturing/production/${id}`, data),
  delete: (id) => axios.delete(`/api/manufacturing/production/${id}`),
};

const itemsAPI = {
  getItems: () => axios.get('/api/setup/items'),
};

// Optimized fetch functions
const fetchProductionPlans = async (params = {}) => {
  const response = await productionAPI.getAll(params);
  return response.data;
};

const fetchAllItems = async () => {
  const response = await itemsAPI.getItems();
  return response.data?.data || [];
};

export const useProductionPlans = (params = {}) => {
  const queryClient = useQueryClient();
  
  const queryKey = ['production-plans', params];

  // Main production plans query
  const { 
    data, 
    error, 
    isLoading,
    isFetching 
  } = useQuery({
    queryKey,
    queryFn: () => fetchProductionPlans(params),
    
    staleTime: 1 * 60 * 1000, // 1 minute cache
    gcTime: 5 * 60 * 1000, // 5 minutes garbage collection
  });

  // Items query for dropdowns
  const {
    data: itemsData,
    isLoading: itemsLoading,
    error: itemsError
  } = useQuery({
    queryKey: ['production-items'],
    queryFn: fetchAllItems,
    staleTime: 10 * 60 * 1000, // 10 minutes cache for items
    gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
  });

  // Mutations with optimistic updates
  const createMutation = useMutation({
    mutationFn: (data) => productionAPI.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-plans'] });
    },
    onError: (error) => {
      const err = error.response?.data?.error || 'Failed to create process order';
      console.log(err);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => productionAPI.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-plans'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => productionAPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-plans'] });
    },
  });


  console.log(error,"error in use 2production")

  return {
    // Data
    productionPlans: data?.data || [],
    items: itemsData || [],
    total: data?.total || 0,
    totalPages: data?.totalPages || 0,
    
    // Loading states
    loading: isLoading,
    fetching: isFetching,
    itemsLoading,
    error: error?.response?.data?.error || error?.message,
    
    // Actions
    createProductionPlan: createMutation.mutateAsync,
    updateProductionPlan: updateMutation.mutateAsync,
    deleteProductionPlan: deleteMutation.mutateAsync,
    
    // Mutation states
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
};

export const useAllProductionPlans = () => {
  const result = useProductionPlans({ 
    limit: 100000,
    page: 1,
    sortOrder: 'desc',
  });
  
  return {
    allProductions: result.productionPlans,
    allProductionsLoading: result.loading,
    allProductionsError: result.error,
    // Include any other properties you need
  };
};