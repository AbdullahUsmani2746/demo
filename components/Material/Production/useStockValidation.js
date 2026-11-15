// hooks/useStockValidation.js
import { useState, useCallback } from 'react';
import axios from 'axios';
import { useStockPolicy } from '@/hooks/useStockPolicy';

// ItemCategory.id of PACKAGING-MATERIAL (Setup → Item Categories)
const PACKAGING_CATEGORY_ID = 4;

// The check follows the stock check policy "processOrder" (Settings → Stock
// checking; the server re-checks on send — lib/manufacturing/processOrder.js):
//   block → { isValid: false } while short (the error modal, as before)
//   warn  → { isValid: true, warnings } — shown, and the order is sent
//   off   → not checked
export const useStockValidation = () => {
  const { screenMode } = useStockPolicy();
  const [isChecking, setIsChecking] = useState(false);
  const [stockErrors, setStockErrors] = useState([]);
  const [stockErrorDetails, setStockErrorDetails] = useState([]);

  // godown: the issue godown of the line (PRODUCTION = 2 when not set)
  const checkMaterialStock = useCallback(async (materialId, requiredQty, materialName, godown = 2) => {
    try {
      const response = await axios.get('/api/inventory/stock', {
        params: {
          itcd: materialId,
          godown: godown || 2,
        }
      });

      const availableStock = response.data.stock || 0;

      // Packaging material (item category 4 = PACKAGING-MATERIAL) is never
      // stock-checked when sending to production.
      if (Number(response.data.categoryId) === PACKAGING_CATEGORY_ID) {
        return {
          materialId,
          materialName: materialName || materialId,
          requiredQty,
          availableStock,
          isSufficient: true,
          shortage: 0,
          skipped: "packing",
        };
      }

      const stockLow = availableStock < requiredQty - 0.01; // 0.01 tolerance
      if (stockLow) {
        return {
          materialId,
          materialName: materialName || materialId,
          requiredQty,
          availableStock,
          isSufficient: false,
          shortage: requiredQty - availableStock
        };
      }

      return {
        materialId,
        materialName: materialName || materialId,
        requiredQty,
        availableStock,
        isSufficient: true,
        shortage: 0
      };
    } catch (error) {
      console.error(`Error checking stock for material ${materialId}:`, error);
      return {
        materialId,
        materialName: materialName || materialId,
        requiredQty,
        availableStock: 0,
        isSufficient: false,
        shortage: requiredQty,
        error: error.message
      };
    }
  }, []);

  const validateProductionPlanStock = useCallback(async (productionPlanDetail, productionType = 'new') => {
    setIsChecking(true);
    setStockErrors([]);
    setStockErrorDetails([]);
    const mode = screenMode('processOrder');
    if (mode === 'off') {
      setIsChecking(false);
      return { isValid: true, errors: [], warnings: [] };
    }

    try {
      // Only check materials, not instructions
      const materials = productionPlanDetail.filter(
        item => item.type === 'material' || (!item.type && item.material_id)
      );

      if (materials.length === 0) {
        setIsChecking(false);
        return { isValid: true, errors: [] };
      }

      // The same item issued on several lines (e.g. for several production
      // items) out of one godown needs the SUM of those lines in stock.
      const needs = new Map();
      for (const material of materials) {
        const godown = Number(material.issue_godown ?? material.godown) || 2;
        const key = `${material.material_id}:${godown}`;
        const prev = needs.get(key);
        needs.set(key, {
          material_id: material.material_id,
          material_desc: material.material_desc,
          godown,
          qty: (prev?.qty || 0) + (parseFloat(material.material_qty) || 0),
        });
      }

      // Check stock for each (item, godown) in parallel
      const stockChecks = await Promise.all(
        [...needs.values()].map(need =>
          checkMaterialStock(need.material_id, Math.round(need.qty * 100) / 100, need.material_desc, need.godown)
            .then((check) => ({ ...check, godown: need.godown }))
        )
      );

      const insufficientMaterials = stockChecks.filter(check => !check.isSufficient);

      if (insufficientMaterials.length > 0) {
        const errors = insufficientMaterials.map(material =>
          `${material.materialName} (${material.materialId}) @ godown ${material.godown}: Required ${material.requiredQty} KG, Available: ${material.availableStock} KG`
        );
        if (mode === 'warn') {
          setIsChecking(false);
          return { isValid: true, errors: [], warnings: errors, insufficientMaterials };
        }
        setStockErrors(errors);
        setStockErrorDetails(insufficientMaterials);
        setIsChecking(false);
        return { isValid: false, errors, insufficientMaterials };
      }

      setIsChecking(false);
      return { isValid: true, errors: [] };
    } catch (error) {
      console.error('Stock validation error:', error);
      const errorMsg = 'Failed to validate material stock. Please try again.';
      setStockErrors([errorMsg]);
      setStockErrorDetails([]);
      setIsChecking(false);
      return { isValid: false, errors: [errorMsg] };
    }
  }, [checkMaterialStock, screenMode]);

  return {
    validateProductionPlanStock,
    isChecking,
    stockErrors,
    stockErrorDetails
  };
};
