import { useState, useEffect, useCallback } from "react";
import { recipeAPI } from "@/components/Manufacturing/api";
import axios from "axios";

export const useRecipes = ({ 
  searchTerm = '', 
  filterStatus = '', 
  page = 1, 
  limit = 100, 
  sortBy = 'receipe_id', 
  sortOrder = 'desc',
  fetchAll = false
}) => {
  const [recipes, setRecipes] = useState([]);
  const [allRecipes, setAllRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchRecipes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      
       

      if (fetchAll) {
        // Fetch ALL recipes without pagination
        const { data } = await recipeAPI.getAll({ 
          search: searchTerm, 
          filterStatus,
          sortBy, 
          sortOrder,
          limit: 10000
        });
        
        setAllRecipes(data.data || []);
        setRecipes(data.data || []);
        setTotal(data.data?.length || 0);
        setTotalPages(1);
      } else {
        // Fetch paginated recipes
        const { data } = await recipeAPI.getAll({ 
          search: searchTerm, 
          filterStatus, 
          page, 
          limit, 
          sortBy, 
          sortOrder 
        });
        
        setRecipes(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      }
      
    } catch (err) {
      console.error('Error fetching recipes:', err);
      setError(err.response?.data?.error || err.message);
      setRecipes([]);
      setAllRecipes([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, filterStatus, page, limit, sortBy, sortOrder, fetchAll]);

  // Recipe Validation Service (unchanged)
  const recipeValidationAPI = {
    validateProductStatus: async (finishedId, recipeId = null) => {
      try {
        const response = await axios.get(`/api/manufacturing/recipe/validation?checkType=productStatus&finishedId=${finishedId}&recipeId=${recipeId}`);
        return response.data;
      } catch (error) {
        console.error('Product status validation error:', error);
        throw error;
      }
    },

    validateBOM: async (bomId) => {
      const response = await axios.get(`/api/manufacturing/recipe/validation?checkType=bomValidation&bomId=${bomId}`);
      return response.data;
    },

    validateMachine: async (machineId) => {
      const response = await axios.get(`/api/manufacturing/recipe/validation?checkType=machineValidation&machineId=${machineId}`);
      return response.data;
    },

    comprehensiveValidation: async (finishedId, bomId, machineId) => {
      const response = await axios.get(`/api/manufacturing/recipe/validation?checkType=comprehensive&finishedId=${finishedId}&bomId=${bomId}&machineId=${machineId}`);
      return response.data;
    },

    finalValidation: async (recipeData) => {
      const response = await axios.get('/api/manufacturing/recipe/validation?checkType=finalValidation', recipeData);
      return response.data;
    }
  };

  const createRecipe = async (recipeData) => {
    setLoading(true);
    setError(null);
    try {
      // Final validation before creating
      // const validation = await recipeValidationAPI.finalValidation(recipeData);
      // if (!validation.isValid) {
      //   throw new Error(validation.errors.join(', '));
      // }

      const { data } = await recipeAPI.create(recipeData);
      await fetchRecipes(); // Refresh the list
      return { success: true, data };
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  const updateRecipe = async (id, recipeData) => {
    setLoading(true);
    setError(null);
    try {
      // // Final validation before updating
      // const validation = await recipeValidationAPI.finalValidation(recipeData);
      // if (!validation.isValid) {
      //   throw new Error(validation.errors.join(', '));
      // }

      const { data } = await recipeAPI.update(id, recipeData);
      await fetchRecipes(); // Refresh the list
      return { success: true, data };
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  const deleteRecipe = async (id) => {
    setLoading(true);
    setError(null);
    try {
      await recipeAPI.delete(id);
      await fetchRecipes(); // Refresh the list
      return { success: true };
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  return {
    recipes: fetchAll ? allRecipes : recipes,
    allRecipes,
    loading,
    error,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    fetchRecipes,
    total,
    totalPages,
    currentPage: page,
    currentLimit: limit,
    isFetchAll: fetchAll,
    validationAPI: recipeValidationAPI
  };
};

// Specialized hook for all Recipes
export const useAllRecipes = (filters = {}) => {
  return useRecipes({
    searchTerm: filters.searchTerm || '',
    filterStatus: filters.filterStatus || '',
    sortBy: filters.sortBy || 'receipe_id',
    sortOrder: filters.sortOrder || 'desc',
    fetchAll: true
  });
};