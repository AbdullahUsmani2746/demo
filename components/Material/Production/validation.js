// utils/validation.js
export const validateProductionPlan = (formData, productionType, reqErrors = []) => {
  const errors = [];

  // SF type ke liye sirf source_sf_id required
  if (productionType === "sf") {
    if (!formData.source_sf_id) {
      errors.push("SF production selection is required");
    }
    if (!formData.finished_id) {
      errors.push("Target finished product is required");
    }
    if (!formData.actual_yield || formData.actual_yield <= 0) {
      errors.push("Actual yield is required for SF to FG production");
    }
    // if (!formData.req_no) {
    //   errors.push("Requisition number is required");
    // }
    // Req qty limit errors
    for (const err of reqErrors) {
      errors.push(err);
    }
    return errors; // baqi sab skip
  }

  // if (productionType === "new") {
  //   if (!formData.req_no) {
  //     errors.push("Requisition number is required");
  //   }
  // }

  // NEW & REPROCESSING ke liye basic validations
  if (!formData.finished_id) {
    errors.push("Target finished product is required");
  }

  if (!formData.dated) {
    errors.push("Plan date is required");
  }

  if (!formData.qty || formData.qty <= 0) {
    errors.push("Production quantity must be greater than 0");
  }

  if (productionType === "new" && !formData.bom_id) {
    errors.push("BOM selection is required for New Production");
  }

  if (productionType === "reprocessing" && (!formData.reprocessing_materials || formData.reprocessing_materials.length === 0)) {
    errors.push("At least one reprocessing item is required");
  }

  return errors;
};

export const validateBatchNumber = async (batchNo, finishedId) => {
  try {
    const response = await fetch(`/api/forms/qualitycontrol/validate-batch?batchNo=${batchNo}&productId=${finishedId}`);
    if (!response.ok) throw new Error('Validation failed');
    const data = await response.json();
    return data.isValid ? [] : ['Batch number already exists for this product'];
  } catch (error) {
    return ['Failed to validate batch number'];
  }
};