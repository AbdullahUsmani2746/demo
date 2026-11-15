import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const checkType = searchParams.get('checkType');
    const finishedId = searchParams.get('finishedId');
    const recipeId = searchParams.get('recipeId');
    const bomId = searchParams.get('bomId');
    const machineId = searchParams.get('machineId');

    

    // SCENARIO 1: Check if product already has active recipe
    if (checkType === 'productStatus') {
      if (!finishedId) {
        return NextResponse.json({ error: 'finishedId is required' }, { status: 400 });
      }

      const existingRecipe = await prisma.rECEIPE_MASTER.findFirst({
        where: {
          finished_id: parseInt(finishedId),
          status: "Active"
        },
        include: {
          item: true,
          receipeDetails: {
            include: {
              item: true
            }
          }
        }
      });

      return NextResponse.json({ 
        hasActiveRecipe: !!existingRecipe, 
        recipe: existingRecipe,
        message: existingRecipe ? 
          `Active recipe already exists for product ${finishedId}` : 
          'No active recipe found'
      });
    }

    // SCENARIO 2: Check if BOM exists and is active
    if (checkType === 'bomValidation') {
      if (!bomId) {
        return NextResponse.json({ error: 'bomId is required' }, { status: 400 });
      }

      const bom = await prisma.bomMaster.findFirst({
        where: {
          id: parseInt(bomId),
          instructions: "A" // Active
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
        bomExists: !!bom,
        bom: bom,
        message: bom ? 
          'BOM is active and valid' : 
          'BOM not found or inactive'
      });
    }

    // SCENARIO 3: Check if machine instructions exist
    if (checkType === 'machineValidation') {
      if (!machineId) {
        return NextResponse.json({ error: 'machineId is required' }, { status: 400 });
      }

      const machine = await prisma.mACHINE_INSTRUCTION_MASTER.findFirst({
        where: {
          rec_id: parseInt(machineId)
        },
        include: {
          machineDetails: true
        }
      });

      return NextResponse.json({ 
        machineExists: !!machine,
        machine: machine,
        message: machine ? 
          'Machine instructions found' : 
          'Machine instructions not found'
      });
    }

    // SCENARIO 4: Comprehensive validation
    if (checkType === 'comprehensive') {
      if (!finishedId || !bomId || !machineId) {
        return NextResponse.json({ error: 'finishedId, bomId, and machineId are required' }, { status: 400 });
      }

      const [
        productStatus,
        bomValidation,
        machineValidation
      ] = await Promise.all([
        // Check 1: Product status - does this product already have an active recipe?
        prisma.rECEIPE_MASTER.findFirst({
          where: { 
            finished_id: parseInt(finishedId), 
            status: "Active" 
          }
        }),
        
        // Check 2: BOM validation - is the BOM active and valid?
        prisma.bomMaster.findFirst({
          where: { 
            id: parseInt(bomId), 
            instructions: "A" 
          },
          include: {
            bomDetails: {
              include: { item: true }
            }
          }
        }),
        
        // Check 3: Machine validation - do machine instructions exist?
        prisma.mACHINE_INSTRUCTION_MASTER.findFirst({
          where: { 
            rec_id: parseInt(machineId)
          },
          include: {
            machineDetails: true
          }
        })
      ]);

      const validationResult = {
        hasActiveRecipe: !!productStatus,
        bomExists: !!bomValidation,
        machineExists: !!machineValidation,
        bomDetails: bomValidation?.bomDetails || [],
        machineDetails: machineValidation?.machineDetails || [],
        isValid: !productStatus && bomValidation && machineValidation,
        warnings: []
      };

      if (productStatus) {
        validationResult.warnings.push('An active recipe already exists for this product');
      }
      if (!bomValidation) {
        validationResult.warnings.push('Selected BOM not found or inactive');
      }
      if (!machineValidation) {
        validationResult.warnings.push('Machine instructions not found');
      }

      
      return NextResponse.json(validationResult);
    }

    // SCENARIO 5: Final recipe validation before save
    if (checkType === 'finalValidation') {
        
      const { finished_id, bom_id, machine_id, receipeDetails, status } = await request.json();

      const validationErrors = [];

      // Check if recipe details are populated
      if (!receipeDetails || receipeDetails.length === 0) {
        validationErrors.push("Recipe must have at least one step");
      }

      // Check for duplicate step numbers
      const stepNumbers = receipeDetails.map(detail => detail.sno);
      const uniqueStepNumbers = new Set(stepNumbers);
      if (stepNumbers.length !== uniqueStepNumbers.size) {
        validationErrors.push("Duplicate step numbers found");
      }

      // Check if all steps have valid data
      const invalidSteps = receipeDetails.filter(detail => 
        !detail.product_id || !detail.sno || detail.sno < 1
      );
      if (invalidSteps.length > 0) {
        validationErrors.push("Some steps have missing required data");
      }

      // Check if active recipe already exists (for new recipes)
      if (status === "Active") {
        const existingActive = await prisma.rECEIPE_MASTER.findFirst({
          where: {
            finished_id: parseInt(finished_id),
            status: "Active"
          }
        });
        if (existingActive) {
          validationErrors.push("An active recipe already exists for this product");
        }
      }

      return NextResponse.json({
        isValid: validationErrors.length === 0,
        errors: validationErrors,
        warnings: []
      });
    }

    return NextResponse.json({ error: 'Invalid checkType' }, { status: 400 });

  } catch (error) {
    console.error('Recipe Validation API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}