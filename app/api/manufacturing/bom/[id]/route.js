// app/api/bom/[id]/route.js
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { guard } from "@/lib/auth/route";
import { bomSaveError, deactivateOtherBoms } from "@/lib/manufacturing/bomRules";

export async function GET(request, { params }) {
  try {
    const bom = await prisma.bomMaster.findUnique({
      where: { id: parseInt(params.id) },
      include: {
        bomDetails: {
          include: { item: {
            include: {itemCategories : true}
          } },
        },
        item: true,
        receipeMasters: true,
      },
    });
    if (!bom) return Response.json({ error: 'Not found' }, { status: 404 });
    const formatted = {
      id: bom.id,
      finishedId: bom.finished_id,
      code: bom.item.code,
      alternate_id: bom.item.alternate_id,
      productName: bom.item.item,
      dateCreated: bom.dated?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
      instructions: bom.instructions,
      status: 'Active',
      materials: bom.bomDetails.map(detail => ({
        id: detail.material_id,
        name: detail.item.item,
        code: detail.item.code,
        percentage: detail.material_percentage,
        category: detail.item.itemCategories.ic_name,

      })),
      linkedRecipes: bom.receipeMasters.map(recipe => recipe.receipe_id),
    };
    return NextResponse.json(formatted, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const PUT = guard("bom.manage", async (request, { params }) => {
  try {
    const data = await request.json();
    const { finished_id, bomDetails, instructions } = data;
    // Settings → Features "bom.percentRule" (lib/manufacturing/bomRules.js)
    const saveError = await bomSaveError(data, { editing: true });
    if (saveError) return NextResponse.json({ error: saveError }, { status: 422 });

    await prisma.$transaction(async (tx) => {
      // Update the BOM master
      await tx.bomMaster.update({
        where: { id: parseInt(params.id) },
        data: {
          finished_id: parseInt(finished_id),
          instructions,
        },
      });

      // Delete existing details and create new ones
      await tx.bomDetail.deleteMany({
        where: { bom_id: parseInt(params.id) },
      });

      for (const mat of bomDetails) {
        await tx.bomDetail.create({
          data: {
            bom_id: parseInt(params.id),
            material_id: parseInt(mat.material_id),
            material_percentage: mat.material_percentage,
          },
        });
      }
      // "bom.oneActivePerItem": the item's other active BOMs become Inactive
      await deactivateOtherBoms(tx, { bomId: params.id, finishedId: finished_id, instructions });
    });

    // Fetch the updated BOM with relations
    const updatedBom = await prisma.bomMaster.findUnique({
      where: { id: parseInt(params.id) },
      include: {
        bomDetails: {
          include: { item: true },
        },
        item: true,
        receipeMasters: true,
      },
    });

    // Format response to match POST method
    const formattedUpdated = {
      id: updatedBom.id,
      finished_id: updatedBom.finished_id, // Fixed field name to match POST
      productName: updatedBom.item.item,
      dateCreated: updatedBom.dated?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
      instructions: updatedBom.instructions,
      status: updatedBom.instructions === 'A' ? 'Active' : 'Inactive',
      bomDetails: updatedBom.bomDetails.map(detail => ({ // Fixed field name to match POST
        material_id: detail.material_id,
        material_desc: detail.item.item,
        material_percentage: detail.material_percentage,
      })),
      linkedRecipes: updatedBom.receipeMasters.map(recipe => recipe.receipe_id),
    };

    return NextResponse.json(formattedUpdated, { status: 200 });
  } catch (error) {
    console.error('PUT Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const DELETE = guard("bom.manage", async (request, { params }) => {
  const id = await params.id
  try {
    await prisma.bomDetail.deleteMany({ where: { bom_id: parseInt(id) } });
    await prisma.bomMaster.delete({ where: { id: parseInt(id) } });
    return NextResponse.json({}, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});