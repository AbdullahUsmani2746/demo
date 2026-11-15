// hooks/useMachineInstruction.js
import { useState, useEffect, useCallback } from "react";
import { machineInstructionAPI } from "@/components/Manufacturing/api";

export const useMachineInstructions = ({ 
  searchTerm = '', 
  filterStatus = '', 
  page = 1, 
  limit = 100, 
  sortBy = 'id', 
  sortOrder = 'desc',
  fetchAll = false 
}) => {
  const [machineInstructions, setMachineInstructions] = useState([]);
  const [allMachineInstructions, setAllMachineInstructions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchMachineInstructions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      
       

      if (fetchAll) {
        // Fetch ALL machine instructions without pagination
        const { data } = await machineInstructionAPI.getAll({ 
          search: searchTerm, 
          status: filterStatus,
          sortBy, 
          sortOrder,
          limit: 10000
        });
        
        setAllMachineInstructions(data.data || []);
        setMachineInstructions(data.data || []);
        setTotal(data.data?.length || 0);
        setTotalPages(1);
      } else {
        // Fetch paginated machine instructions
        const { data } = await machineInstructionAPI.getAll({ 
          search: searchTerm, 
          status: filterStatus, 
          page, 
          limit, 
          sortBy, 
          sortOrder 
        });
        
        setMachineInstructions(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      }
      
    } catch (err) {
      console.error('Error fetching machine instructions:', err);
      setError(err.response?.data?.error || err.message);
      setMachineInstructions([]);
      setAllMachineInstructions([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, filterStatus, page, limit, sortBy, sortOrder, fetchAll]);

  const createMachineInstruction = async (machineData) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await machineInstructionAPI.create(machineData);
      await fetchMachineInstructions(); // Refresh the list
      return { success: true, data };
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      return { success: false, error: err.response?.data?.error || err.message };
    } finally {
      setLoading(false);
    }
  };

  const updateMachineInstruction = async (id, machineData) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await machineInstructionAPI.update(id, machineData);
      await fetchMachineInstructions(); // Refresh the list
      return { success: true, data };
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      return { success: false, error: err.response?.data?.error || err.message };
    } finally {
      setLoading(false);
    }
  };

  const deleteMachineInstruction = async (id) => {
    setLoading(true);
    setError(null);
    try {
      await machineInstructionAPI.delete(id);
      await fetchMachineInstructions(); // Refresh the list
      return { success: true };
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      return { success: false, error: err.response?.data?.error || err.message };
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMachineInstructions();
  }, [fetchMachineInstructions]);

  return {
    machineInstructions: fetchAll ? allMachineInstructions : machineInstructions,
    allMachineInstructions,
    loading,
    error,
    total,
    totalPages,
    currentPage: page,
    currentLimit: limit,
    isFetchAll: fetchAll,
    createMachineInstruction,
    updateMachineInstruction,
    deleteMachineInstruction,
    fetchMachineInstructions,
  };
};

// Specialized hook for all Machine Instructions
export const useAllMachineInstructions = (filters = {}) => {
  return useMachineInstructions({
    searchTerm: filters.searchTerm || '',
    filterStatus: filters.filterStatus || '',
    sortBy: filters.sortBy || 'id',
    sortOrder: filters.sortOrder || 'desc',
    fetchAll: true
  });
};