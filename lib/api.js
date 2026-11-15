import axios from "axios";

export const submitVoucher = async (type, data) => {
  return axios.post(`/api/voucher?type=${type}`, data);
};

const api = axios.create({
  baseURL: "/api",
});

export const fetchItems = async (params = {}) => {
  // Build query string from params
  const queryParams = new URLSearchParams();

  if (params.page) queryParams.append("page", params.page);
  if (params.limit) queryParams.append("limit", params.limit);
  if (params.search) queryParams.append("search", params.search);
  if (params.sortField) queryParams.append("sortField", params.sortField);
  if (params.sortOrder) queryParams.append("sortOrder", params.sortOrder);
  if (params.export) queryParams.append("export", params.export);
  if (params.category) queryParams.append("category", params.category);

  if (params.categories) queryParams.append("category", params.categories);

  const queryString = queryParams.toString();
  const url = queryString ? `/forms/items?${queryString}` : "/forms/items";

  const response = await api.get(url);
  return response.data;
};

export const fetchItem = async (id) => {
  const response = await api.get(`/forms/items/${id}`);
  return response.data;
};

export const createItem = async (data) => {
  const response = await api.post("/forms/items", data);
  return response.data;
};

export const updateItem = async (id, data) => {
  const response = await api.put(`/forms/items/${id}`, data);
  return response.data;
};

export const deleteItem = async (id) => {
  await api.delete(`/forms/items/${id}`);
};

export const fetchSubtrates = async () => {
  const response = await api.get("/setup/subtrates");
  return response.data.data;
};

export const fetchCategories = async () => {
  const response = await api.get("/setup/item_categories");
  return response.data.data;
};

// export const fetchItemQuality = async (id) => {
//   const response = await api.get(`/forms/quality/${id}`);
//   return response.data;
// };

export const fetchQualityParameters = async () => {
  const response = await api.get("/setup/quality_parameters");
  return response.data.data;
};

// Fetch packing materials
export const fetchPackingMaterials = async () => {
  const response = await api.get("/setup/items");
  return response.data.data;
};


// Fetch item quality parameters
export const fetchItemQuality = async (itemId) => {
  const response = await fetch(`/api/forms/items/${itemId}/quality`);
  if (!response.ok) throw new Error("Failed to fetch item quality");
  return response.json();
};

// Save item quality parameters
export const saveItemQuality = async (itemId, qualityParams) => {
  const response = await fetch(`/api/forms/items/${itemId}/quality`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      qualityParameters: qualityParams,
    }),
  });
  if (!response.ok) throw new Error("Failed to save quality parameters");
  return response.json();
};
