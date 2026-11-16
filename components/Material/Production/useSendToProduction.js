// hooks/useSendToProduction.js
import axios from "axios";
import { useState } from "react";

export const useSendToProduction = () => {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);

  const sendToProduction = async (productionPlanId, actualYield, adjustedItems = {}, actualYields = {}) => {
    setIsSending(true);
    setError(null);

    try {
      const response = await axios.post(
        "/api/manufacturing/production/send-to-production",
        { 
          productionPlanId,
          actualYield,
          actualYields,
          adjustedItems, // Pass adjusted quantities with wastage applied
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = response.data;

      if (response.status !== 200) {
        throw new Error(data.error || "Failed to send to production");
      }

      setIsSending(false);
      return { success: true, data };
    } catch (err) {
      // The route's own reason (QC gate, period lock, stock …), not axios' "status code 422".
      const message = err.response?.data?.error || err.response?.data?.message || err.message;
      setError(message);
      setIsSending(false);
      return { success: false, error: message };
    }
  };

  return { sendToProduction, isSending, error };
};