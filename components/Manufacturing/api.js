// components/Manufacturing/api.js
import axios from 'axios';

export const bomAPI = {
  getAll: async (params = {}) => {
    const { search, filterStatus, page, limit, sortBy, sortOrder } = params;
    
    const queryParams = new URLSearchParams();
    if (search) queryParams.append('search', search);
    if (filterStatus) queryParams.append('filterStatus', filterStatus);
    if (page) queryParams.append('page', page);
    if (limit) queryParams.append('limit', limit);
    if (sortBy) queryParams.append('sortBy', sortBy);
    if (sortOrder) queryParams.append('sortOrder', sortOrder);

    const url = `/api/manufacturing/bom?${queryParams.toString()}`;
    
    
    return axios.get(url);
  },
  create: (data) => axios.post('/api/manufacturing/bom', data),
  update: (id, data) => axios.put(`/api/manufacturing/bom/${id}`, data),
  delete: (id) => axios.delete(`/api/manufacturing/bom/${id}`),
};

export const productionAPI = {
  getAll: async (params = {}) => {
    const { 
      search, 
      filterStatus, 
      page, 
      limit, 
      sortBy, 
      sortOrder,
      fetchAll 
    } = params;
    
    const queryParams = new URLSearchParams();
    
    // Common parameters
    if (search) queryParams.append('search', search);
    if (filterStatus) queryParams.append('filterStatus', filterStatus);
    if (sortBy) queryParams.append('sortBy', sortBy);
    if (sortOrder) queryParams.append('sortOrder', sortOrder);
    
    // Handle fetchAll mode
    if (fetchAll) {
      queryParams.append('limit', 100000); // Large limit to get all records
    } else {
      // Pagination parameters
      if (page) queryParams.append('page', page);
      if (limit) queryParams.append('limit', limit);
    }
    
    const url = `/api/manufacturing/production?${queryParams.toString()}`;
    
    
    return axios.get(url);
  },
  create: (data) => axios.post('/api/manufacturing/production', data),
  update: (id, data) => axios.put(`/api/manufacturing/production/${id}`, data),
  delete: (id) => axios.delete(`/api/manufacturing/production/${id}`),
};

export const recipeAPI = {
  getAll: async (params = {}) => {
    const { 
      search, 
      filterStatus, 
      page, 
      limit, 
      sortBy, 
      sortOrder,
      fetchAll 
    } = params;
    
    const queryParams = new URLSearchParams();
    
    // Common parameters
    if (search) queryParams.append('search', search);
    if (filterStatus) queryParams.append('filterStatus', filterStatus);
    if (sortBy) queryParams.append('sortBy', sortBy);
    if (sortOrder) queryParams.append('sortOrder', sortOrder);
    
    // Handle fetchAll mode
    if (fetchAll) {
      queryParams.append('limit', 100000); // Large limit to get all records
    } else {
      // Pagination parameters
      if (page) queryParams.append('page', page);
      if (limit) queryParams.append('limit', limit);
    }
    
    const url = `/api/manufacturing/recipe?${queryParams.toString()}`;
    
    
    return axios.get(url);
  },
  create: (data) => axios.post('/api/manufacturing/recipe', data),
  update: (id, data) => axios.put(`/api/manufacturing/recipe/${id}`, data),
  delete: (id) => axios.delete(`/api/manufacturing/recipe/${id}`),
};

export const machineInstructionAPI = {
 getAll: async (params = {}) => {
    const { 
      search, 
      filterStatus, 
      status, // Support both naming conventions
      page, 
      limit, 
      sortBy, 
      sortOrder,
      fetchAll 
    } = params;
    
    const queryParams = new URLSearchParams();
    
    // Common parameters
    if (search) queryParams.append('search', search);
    
    // Status filter - support both filterStatus and status
    const statusValue = filterStatus || status;
    if (statusValue) queryParams.append('status', statusValue);
    
    if (sortBy) queryParams.append('sortBy', sortBy);
    if (sortOrder) queryParams.append('sortOrder', sortOrder);
    
    // Handle fetchAll mode
    if (fetchAll) {
      queryParams.append('limit', 100000); // Large limit to get all records
    } else {
      // Pagination parameters
      if (page) queryParams.append('page', page);
      if (limit) queryParams.append('limit', limit);
    }
    
    const url = `/api/manufacturing/machine-instruction?${queryParams.toString()}`;
    
    
    return axios.get(url);
  },
  create: (data) => axios.post('/api/manufacturing/machine-instruction', data),
  update: (id, data) => axios.put(`/api/manufacturing/machine-instruction/${id}`, data),
  delete: (id) => axios.delete(`/api/manufacturing/machine-instruction/${id}`),
};