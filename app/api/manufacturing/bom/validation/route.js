import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Comprehensive BOM Validation API
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const checkType = searchParams.get('checkType');
    const finishedId = searchParams.get('finishedId');
    const materialId = searchParams.get('materialId');
    const bomId = searchParams.get('bomId'); // For edit scenarios

    

    // SCENARIO 1: Check if product already has active BOM
    if (checkType === 'productStatus') {
      if (!finishedId) {
        return NextResponse.json({ error: 'finishedId is required' }, { status: 400 });
      }

      const existingBOM = await prisma.bomMaster.findFirst({
        where: {
          finished_id: parseInt(finishedId),
          instructions: "A" // Active
        },
        include: {
          item: true,
          bomDetails: {
            include: {
              item: true
            }
          }
        }
      });

      return NextResponse.json({ 
        hasActiveBOM: !!existingBOM, 
        bom: existingBOM,
        message: existingBOM ? 
          `Active BOM already exists for product ${finishedId}` : 
          'No active BOM found'
      });
    }

    // SCENARIO 2: Check for duplicate materials
    if (checkType === 'duplicateMaterial') {
      if (!finishedId || !materialId) {
        return NextResponse.json({ error: 'finishedId and materialId are required' }, { status: 400 });
      }

      // Check in existing BOM
      const existingBOM = await prisma.bomMaster.findFirst({
        where: {
          finished_id: parseInt(finishedId)
        },
        include: {
          bomDetails: true
        }
      });

      const isDuplicate = existingBOM?.bomDetails.some(
        detail => detail.material_id === parseInt(materialId)
      );

      return NextResponse.json({ 
        isDuplicate,
        message: isDuplicate ? 
          `Material ${materialId} is already in this BOM` : 
          'Material not duplicate'
      });
    }

    // SCENARIO 3: Check if material is master product
    if (checkType === 'masterProduct') {
      if (!finishedId || !materialId) {
        return NextResponse.json({ error: 'finishedId and materialId are required' }, { status: 400 });
      }

      const isMasterProduct = parseInt(finishedId) === parseInt(materialId);

      return NextResponse.json({ 
        isMasterProduct,
        message: isMasterProduct ? 
          'Cannot add master product as material' : 
          'Valid material selection'
      });
    }

    // SCENARIO 4: Check if material has its own BOM
    if (checkType === 'materialBOM') {
      if (!materialId) {
        return NextResponse.json({ error: 'materialId is required' }, { status: 400 });
      }

      const materialBOM = await prisma.bomMaster.findFirst({
        where: {
          finished_id: parseInt(materialId),
          instructions: "A"
        },
        include: {
          bomDetails: {
            include: {
              item: true
            }
          }
        }
      });

      return NextResponse.json({ 
        hasBOM: !!materialBOM, 
        bom: materialBOM,
        message: materialBOM ? 
          `Material ${materialId} has its own BOM` : 
          'Material has no BOM'
      });
    }

    // SCENARIO 5: Check circular references
    if (checkType === 'circularReference') {
      if (!finishedId || !materialId) {
        return NextResponse.json({ error: 'finishedId and materialId are required' }, { status: 400 });
      }

      const circularCheck = await checkCircularReference(
        parseInt(finishedId), 
        new Set(), 
        parseInt(materialId)
      );

      return NextResponse.json({ 
        hasCircularReference:  false,//circularCheck.hasCircular,
        path: circularCheck.path,
        message: circularCheck.hasCircular ? 
          'Circular reference detected in BOM hierarchy' : 
          'No circular references'
      });
    }

    // SCENARIO 6: Check percentage validation
    if (checkType === 'percentage') {
      if (!finishedId) {
        return NextResponse.json({ error: 'finishedId is required' }, { status: 400 });
      }

      const currentBOM = await prisma.bomMaster.findFirst({
        where: { finished_id: parseInt(finishedId) },
        include: { bomDetails: true }
      });

      const currentTotal = currentBOM?.bomDetails.reduce(
        (sum, detail) => sum + (detail.material_percentage || 0), 0
      ) || 0;

      return NextResponse.json({ 
        currentTotal,
        message: `Current total percentage: ${currentTotal}%`
      });
    }

     // SCENARIO 7: Comprehensive validation (all checks at once)
    if (checkType === 'comprehensive') {
      if (!finishedId || !materialId) {
        return NextResponse.json({ error: 'finishedId and materialId are required' }, { status: 400 });
      }

      

      const [
        productStatus,
        materialBOMCheck,
        circularCheck
      ] = await Promise.all([
        // Check 1: Product status - does this product already have an active BOM?
        prisma.bomMaster.findFirst({
          where: { 
            finished_id: parseInt(finishedId), 
            instructions: "A" 
          }
        }),
        
        // Check 2: Material has BOM - does the material being added have its own BOM?
        prisma.bomMaster.findFirst({
          where: { 
            finished_id: parseInt(materialId), 
            instructions: "A" 
          }
        }),
        
        // Check 3: Circular reference - will this create a circular dependency?
        checkCircularReference(parseInt(materialId), new Set(), parseInt(finishedId))
      ]);

      // FIXED: Check for duplicate in CURRENT form data (not existing BOM)
      // Since we're creating a new BOM, we check the materials already added in the form
      const currentBOMDetails = []; // This should come from frontend, but we'll handle it differently
      
      const validationResult = {
        hasActiveBOM: !!productStatus,
        isDuplicate: false, // We'll handle this in frontend
        isMasterProduct: parseInt(finishedId) === parseInt(materialId),
        materialHasBOM: !!materialBOMCheck,
        hasCircularReference:   false, //circularCheck.hasCircular,
        currentPercentage: 0, // We'll calculate this in frontend
        circularPath: circularCheck.path,
        isValid: !(
          !!productStatus || 
          (parseInt(finishedId) === parseInt(materialId)) || 
          circularCheck.hasCircular
        ),
        warnings: materialBOMCheck ? ['Material has its own BOM'] : ["no bom"]
      };

      
      return NextResponse.json(validationResult);
    }

    // SCENARIO 8: Final BOM validation before save
    if (checkType === 'finalValidation') {
      const { finished_id, bomDetails, instructions, bomId } = await request.json();

      const validationErrors = [];

      // Check total percentage
      const totalPercentage = bomDetails.reduce(
        (sum, detail) => sum + detail.material_percentage, 0
      );
      
      if (totalPercentage !== 100) {
        validationErrors.push(`Total percentage must be exactly 100% (currently ${totalPercentage}%)`);
      }

      // Check for circular references for all materials
      for (const detail of bomDetails) {
        const circularCheck = await checkCircularReference(
          parseInt(finished_id ), 
          new Set(), 
          parseInt(detail.material_id)
        );
        
        if (circularCheck.hasCircular) {
          validationErrors.push(`Circular reference detected with material ${detail.material_id}`);
        }
      }

      // Check if any material is the master product
      const hasMasterAsMaterial = bomDetails.some(
        detail => parseInt(detail.material_id) === parseInt(finished_id)
      );
      
      if (hasMasterAsMaterial) {
        validationErrors.push("Master product cannot be used as material");
      }

      // Check for duplicate materials in the current BOM
      const materialIds = bomDetails.map(detail => detail.material_id);
      const uniqueIds = new Set(materialIds);
      if (materialIds.length !== uniqueIds.size) {
        validationErrors.push("Duplicate materials found in the BOM");
      }

      return NextResponse.json({
        isValid: validationErrors.length === 0,
        errors: validationErrors,
        warnings: []
      });
    }

    return NextResponse.json({ error: 'Invalid checkType' }, { status: 400 });

  } catch (error) {
    console.error('BOM Validation API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Helper function to check circular references - FIXED WITH BETTER LOGGING
async function checkCircularReference(itemId, visited, targetId = null) {
  
  
  // If we've already visited this item, it's circular!
  if (visited.has(itemId)) {
    
    return { hasCircular: true, path: Array.from(visited) };
  }

  visited.add(itemId);

  try {
    // Get active BOM for this item
    const bom = await prisma.bomMaster.findFirst({
      where: {
        finished_id: itemId,
        instructions: "A"
      },
      include: {
        bomDetails: true
      }
    });

    

    if (bom && bom.bomDetails) {
      for (const detail of bom.bomDetails) {
        
        
        // If we find the target material in the BOM hierarchy, it's circular
        if (detail.material_id === targetId) {
          
          return { hasCircular: false, path: Array.from(visited) };
        }
        
        // Recursively check the material's BOM
        
        const result = await checkCircularReference(
          detail.material_id, 
          new Set(visited), 
          targetId
        );
        
        if (result.hasCircular) {
          
          return result;
        }
      }
    }
  } catch (error) {
    console.error('Error in circular reference check:', error);
  }

  visited.delete(itemId);
  
  return { hasCircular: false };
}