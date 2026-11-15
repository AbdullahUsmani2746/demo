// hooks/useDropdownData.js
import { useState, useEffect } from 'react';

export const useSaleOrders = () => {
  const [saleOrders, setSaleOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSaleOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      // approvedOnly: Free of Cost / Trial orders waiting for CEO approval
      // (status 3) cannot be produced against yet.
      // The orders API returns 10 by default, newest first — take the latest 60.
      // Older ones are found by typing in the dropdown (ProcessOrderForm
      // loadSaleOrderOptions searches the server).
      const response = await fetch('/api/orders/saleOrder?approvedOnly=true&limit=60');
      if (!response.ok) throw new Error('Failed to fetch sale orders');
      const data = await response.json();
      setSaleOrders(data.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSaleOrders();
  }, []);

  return { saleOrders, loading, error, refetch: fetchSaleOrders };
};

export const useBatchNumbers = (finishedId) => {
  const [batchNumbers, setBatchNumbers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBatchNumbers = async (productId) => {
    if (!productId) {
      setBatchNumbers([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/forms/qualitycontrol/batch-numbers?productId=${productId}`);
      if (!response.ok) throw new Error('Failed to fetch batch numbers');
      const data = await response.json();
      setBatchNumbers(data.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (finishedId) {
      fetchBatchNumbers(finishedId);
    }
  }, [finishedId]);

  return { batchNumbers, loading, error, refetch: fetchBatchNumbers };
};