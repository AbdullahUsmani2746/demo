import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { guard } from "@/lib/auth/route";

// GET: Fetch all recipes with pagination, sorting, and filtering
// export async function GET(request) {
//   const { searchParams } = new URL(request.url);
//   const search = searchParams.get('search') || '';
//   const status = searchParams.get('status') || '';
//   const page = parseInt(searchParams.get('page') || '1');
//   const limit = parseInt(searchParams.get('limit') || '10');
//   const sortBy = searchParams.get('sortBy') || 'id';
//   const sortOrder = searchParams.get('sortOrder') || 'asc';

//   try {
//     const where = {};
//     if (search) {
//       where.OR = [
//         { item: { item: { contains: search, mode: 'insensitive' } } },
//         { finished_id: { contains: search, mode: 'insensitive' } },
//       ];
//     }
//     if (status) {
//       where.status = status;
//     }

//     const orderBy = { [sortBy]: sortOrder };

//     const total = await prisma.rECEIPE_MASTER.count({ where });
//     const recipes = await prisma.rECEIPE_MASTER.findMany({
//       where,
//       orderBy,
//       skip: (page - 1) * limit,
//       take: limit,
//       include: {
//         item: true,
//         bomMaster: { select: { id: true } },
//         // machine: { select: { itcd: true, item: true } },
//         receipeDetails: { include: { item: true } },
//       },
//     });

//     const formatted = recipes.map(recipe => ({
//       id: recipe.id,
//       finishedId: recipe.finished_id,
//       productName: recipe.item?.item || 'Unknown',
//       finishedCount: recipe.finished_count,
//       machineId: recipe.machine_id,
//       machineName: recipe.machine?.item || 'Unknown',
//       bomId: recipe.bom_id,
//       linkedBom: recipe.bomMaster?.id || 'None',
//       timeMin: recipe.time_min,
//       status: recipe.status || 'Active',
//       date: recipe.date?.toISOString().split('T')[0] || '',
//       details: recipe.receipeDetails.map(detail => ({
//         productId: detail.item_id,
//         productDesc: detail.item?.item || detail.description || '',
//         qty: detail.quantity,
//         percentage: detail.percentage,
//         sno: detail.sno,
//       })),
//     }));

//     return NextResponse.json({ data: formatted, total }, { status: 200 });
//   } catch (error) {
//     return NextResponse.json({ error: error.message }, { status: 500 });
//   }
// }

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const finished_id = searchParams.get('finished_id');
  const machine_id = searchParams.get('machine_id');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  let sortBy = searchParams.get('sortBy') || 'receipe_id';
  const sortOrder = searchParams.get('sortOrder') || 'asc';

  if (sortBy === 'id') {
    sortBy = 'receipe_id';
  }

  try {
    const where = {};

    if (machine_id && !isNaN(machine_id)) {
      where.machine_id = parseInt(machine_id);
    }

    // Filter by specific finished_id (used by SF-to-FG recipe lookup)
    if (finished_id && !isNaN(finished_id)) {
      where.finished_id = parseInt(finished_id);
    }

    if (search) {
      const searchNum = parseInt(search);
      const conditions = [];

      // finished_id NUMBER hai - contains nahi chalta, equals use karo
      if (!isNaN(searchNum)) {
        conditions.push({ finished_id: searchNum });
        conditions.push({ receipe_id: searchNum });
      }

      // item.item STRING hai - contains chalta hai
      conditions.push({
          item: {
            OR: [
              { item: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } }
            ]
          }
        });

      where.OR = conditions;
    }

    if (status) {
      where.status = status;
    }

    const orderBy = { [sortBy]: sortOrder };

    const total = await prisma.rECEIPE_MASTER.count({ where });
    

    const recipes = await prisma.rECEIPE_MASTER.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        item: true,
        receipeDetails: true,
      },
    });

    return NextResponse.json({ data: recipes, total }, { status: 200 });
  } catch (error) {
    console.error("Recipe GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const POST = guard("recipe.manage", async (request) => {
  try {
    const body = await request.json();
    const {
      finished_id,
      machine_id,
      bom_id,
      time_min,
      status,
      dated,
      receipeDetails
    } = body;

    
      

    // Create recipe master
    const recipe = await prisma.rECEIPE_MASTER.create({
      data: {
        finished_id: parseInt(finished_id),
        machine_id: machine_id ? parseInt(machine_id) : null,
        bom_id: bom_id ? parseInt(bom_id) : null,
        time_min: time_min ? parseInt(time_min) : null,
        status: status,
        dated: new Date(dated),
      },
    });

    

    // Create recipe details - REMOVE instructions field
    if (receipeDetails && receipeDetails.length > 0) {
      const recipeDetailsData = receipeDetails.map(detail => ({
        receipe_id: recipe.receipe_id,
        product_id: detail.product_id ? parseInt(detail.product_id) : null,
        product_desc: detail.type === "instruction" ? detail.instructions : detail.product_desc,
        qty: detail.qty ? parseInt(detail.qty) : null,
        product_percentage: detail.product_percentage ? parseFloat(detail.product_percentage) : null,
        sno: detail.sno ? parseInt(detail.sno) : null,
      }));

      await prisma.rECEIPE_DETAIL.createMany({
        data: recipeDetailsData
      });

      
    }

    // Return the complete recipe with details
    const completeRecipe = await prisma.rECEIPE_MASTER.findUnique({
      where: { receipe_id: recipe.receipe_id },
      include: {
        receipeDetails: true,
        item: true,
        bomRef: {
          include: {
            item: true
          }
        }
      }
    });

    return NextResponse.json(completeRecipe, { status: 201 });
  } catch (error) {
    console.error('Recipe Creation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});