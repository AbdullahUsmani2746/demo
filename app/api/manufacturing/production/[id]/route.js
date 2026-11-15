// /api/manufacturing/production/[id]

import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { buildProductionBarcode } from "@/lib/productionBarcode.js";
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { guard } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";
import { normalizeOrder, validateOrder, replaceLines, validateOrderReferences, loadLines, effectiveOutputs, linesReady, saveOutputYields, updatePostedYields } from '@/lib/manufacturing/processOrder';
import { recordScopeError } from '@/lib/auth/documentScope';

// GET: Fetch all production plans with pagination, sorting, and filtering
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const sortBy = searchParams.get('sortBy') || 'id';
  const sortOrder = searchParams.get('sortOrder') || 'asc';
  

  try {
    const where = {};
    if (search) {
      where.OR = [
        { item: { item: { contains: search, mode: 'insensitive' } } },
        { finished_id: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) {
      where.status = status;
    }

    const orderBy = { [sortBy]: sortOrder };

    const total = await prisma.productionPlan.count({ where });
    const plans = await prisma.productionPlan.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        item: true,
        bomMaster: { include: { bomDetails: { include: { item: true } } } },
      },
    });

    const formatted = plans.map(plan => ({
      id: plan.id,
      finishedId: plan.finished_id,
      productName: plan.item?.item || 'Unknown',
      date: plan.date?.toISOString().split('T')[0] || '',
      qty: plan.quantity,
      status: plan.status || 'Scheduled',
      materialRequirements: plan.bomMaster?.bomDetails.map(detail => ({
        id: detail.item.itcd,
        name: detail.item.item,
        percentage: detail.percentage,
        required: (plan.quantity * detail.percentage) / 100,
      })) || [],
    }));

    return NextResponse.json({ data: formatted, total }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const PUT = guard("materialInput.create", async (request, { params }) => {
  try {
    const session = await getServerSession(authOptions);
    const data = await request.json();
    const {
      receipe_id,
      finished_id,
      qty,
      dated,
      req_del_date,
      batch_no,
      sale_ord_no,
      actual_yield,
      viscosity,
      machine_id,
      time_min,
      bom_id,
      productionPlanDetail,
      status,
      changeLogs,
    } = data;

    const planId = parseInt(params.id);

    
    // Retrieve the current plan first to verify status, sent_to_production_date and previous actual_yield
    const currentPlan = await prisma.productionPlanMaster.findUnique({
      where: { id: planId },
      include: { productionPlanDetail: { include: { issueLine: true }, orderBy: { sno: 'asc' } } },
    });

    if (!currentPlan) {
      return NextResponse.json({ error: "Production plan not found" }, { status: 404 });
    }

    // Plan date (old + new) and, once posted, the date its T7/T8 were posted on
    const lockError = await checkPeriodLock(
      [currentPlan.dated, dated, currentPlan.sent_to_production_date],
      8,
      { action: "update" },
    );
    if (lockError) {
      return NextResponse.json({ error: lockError }, { status: 422 });
    }

    if (Array.isArray(data.outputs) && (data.type === 'new' || data.type === 'reprocessing')) {
      const order = normalizeOrder(data);
      if (currentPlan.status === 'Posted') {
        const errors = validateOrder(order);
        if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 422 });
        const { outputsByPlan } = await loadLines([planId]);
        const storedOutputs = effectiveOutputs(currentPlan, outputsByPlan.get(planId));
        if (order.outputs.length !== storedOutputs.length || order.outputs.some((output, index) => {
          const stored = storedOutputs[index];
          return !stored || output.line_no !== stored.line_no || output.finished_id !== stored.finished_id ||
            Math.abs(Number(output.qty) - Number(stored.qty)) > 1e-6 || output.bom_id !== stored.bom_id ||
            (output.batch_no || null) !== (stored.batch_no || null) ||
            (output.godown != null && Number(output.godown) !== Number(stored.godown));
        })) {
          return NextResponse.json({ error: 'Posted output items, planned quantities, BOMs, batches, and godowns are locked.' }, { status: 409 });
        }
        const detailsChanged = order.details.length !== currentPlan.productionPlanDetail.length || order.details.some((detail, index) => {
          const stored = currentPlan.productionPlanDetail[index];
          const issue = stored?.issueLine;
          return !stored || detail.material_id !== stored.material_id ||
            Math.abs(Number(detail.material_qty) - Number(stored.material_qty)) > 1e-6 ||
            Math.abs(Number(detail.material_percentage) - Number(stored.material_percentage)) > 1e-6 ||
            (detail.material_desc || '') !== (stored.material_desc || '') ||
            detail.output_line !== (issue?.output_line ?? 1) ||
            (detail.material_id && detail.godown != null && Number(detail.godown) !== Number(issue?.godown ?? 2)) ||
            (detail.material_id && detail.unit && detail.unit !== (issue?.unit || 'KG'));
        });
        if (detailsChanged) return NextResponse.json({ error: 'Posted material and instruction lines are locked.' }, { status: 409 });
        if (order.outputs.some((output, index) => output.actual_yield == null && storedOutputs[index]?.actual_yield != null)) {
          return NextResponse.json({ error: 'A posted actual yield cannot be cleared.' }, { status: 422 });
        }
        const changes = order.outputs
          .filter((output, index) => output.actual_yield != null && Number(output.actual_yield) !== Number(storedOutputs[index].actual_yield ?? storedOutputs[index].qty))
          .map((output) => ({ line_no: output.line_no, finished_id: output.finished_id, qty: output.actual_yield }));
        if (changes.length) {
          const sentDate = currentPlan.sent_to_production_date || currentPlan.dated;
          if (sentDate && Date.now() - new Date(sentDate).getTime() > 24 * 60 * 60 * 1000) {
            return NextResponse.json({ error: 'Actual yield cannot be edited after 24 hours of posting.' }, { status: 400 });
          }
          if (changes.some((change) => !(change.qty > 0))) {
            return NextResponse.json({ error: 'Actual yield must be greater than zero.' }, { status: 422 });
          }
        }
        const updated = await prisma.$transaction(async (tx) => {
          if (changes.length) {
            await updatePostedYields(tx, planId, changes);
            await saveOutputYields(tx, planId, Object.fromEntries(order.outputs.map((output) => [output.line_no, output.actual_yield ?? output.qty])));
          }
          if (changes.some((change) => change.line_no === 1)) {
            return tx.productionPlanMaster.update({
              where: { id: planId },
              data: { actual_yield: changes.find((change) => change.line_no === 1).qty },
            });
          }
          return currentPlan;
        });
        return NextResponse.json({ ...updated, outputs: order.outputs }, { status: 200 });
      }
      const errors = validateOrder(order);
      if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 422 });
      const referenceCheck = await validateOrderReferences(order);
      if (referenceCheck.error) return NextResponse.json({ error: referenceCheck.error }, { status: 422 });
      for (const godown of referenceCheck.godowns) {
        const scopeError = await recordScopeError(session, 'godown', [godown]);
        if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });
      }
      const first = order.outputs[0];
      const updated = await prisma.$transaction(async (tx) => {
        await tx.productionPlanMaster.update({
          where: { id: planId },
          data: {
            finished_id: first.finished_id,
            bom_id: first.bom_id,
            qty: first.qty,
            actual_yield: first.actual_yield,
            batch_no: first.batch_no,
            m2m: Boolean(data.m2m),
            req_no: data.req_no ? Number(data.req_no) : null,
            dated: new Date(dated),
            req_del_date: req_del_date ? new Date(req_del_date) : null,
            receipe_id: receipe_id ? Number(receipe_id) : null,
            machine_id: machine_id ? Number(machine_id) : null,
            time_min: time_min ? Number(time_min) : null,
            viscosity: viscosity || null,
            sale_ord_no: sale_ord_no ? Number(sale_ord_no) : null,
          },
        });
        if (Array.isArray(changeLogs) && changeLogs.length) {
          await tx.productionPlanChangeLog.createMany({
            data: changeLogs.map((log) => ({
              plan_id: planId,
              detail_id: log.detail_id || null,
              field_name: log.field_name,
              old_value: log.old_value,
              new_value: log.new_value,
              material_id: log.material_id ? Number(log.material_id) : null,
              material_desc: log.material_desc || null,
              changed_by: session?.user?.name || session?.user?.email || 'unknown',
              change_reason: log.change_reason || null,
            })),
          });
        }
        await replaceLines(tx, planId, order);
        return tx.productionPlanMaster.findUnique({
          where: { id: planId },
          include: {
            item: true,
            outputs: { orderBy: { line_no: 'asc' } },
            productionPlanDetail: { include: { item: true, issueLine: true }, orderBy: { sno: 'asc' } },
            changeLogs: { orderBy: { changed_at: 'desc' }, take: 50 },
          },
        });
      });
      return NextResponse.json({
        ...updated,
        outputs: updated.outputs,
        productionPlanDetail: updated.productionPlanDetail.map((detail) => ({
          ...detail,
          output_line: detail.issueLine?.output_line || 1,
          issue_godown: detail.issueLine?.godown ?? null,
          issue_unit: detail.issueLine?.unit || 'KG',
        })),
      }, { status: 200 });
    }

    // Check 24 hour restriction if it's already Posted and actual_yield is being updated
    if (currentPlan.status === 'Posted' && actual_yield !== undefined && parseFloat(actual_yield) !== currentPlan.actual_yield) {
      const sentDate = currentPlan.sent_to_production_date || currentPlan.dated;
      if (sentDate && (new Date() - new Date(sentDate)) > 24 * 60 * 60 * 1000) {
        return NextResponse.json({ error: "Actual yield cannot be edited after 24 hours of posting." }, { status: 400 });
      }
    }

    await prisma.productionPlanMaster.update({
      where: { id: planId },
      data: {
        receipe_id: receipe_id ? parseInt(receipe_id) : null,
        finished_id: parseInt(finished_id),
        bom_id: bom_id ? parseInt(bom_id) : null,
        qty: parseFloat(qty),
        dated: new Date(dated),
        req_del_date: req_del_date ? new Date(req_del_date) : null,
        batch_no: batch_no || null,
        machine_id: machine_id ? parseInt(machine_id) : null,
        time_min: time_min ? parseInt(time_min) : null,
        actual_yield: actual_yield ? parseFloat(actual_yield) : null,
        viscosity: viscosity || null,
        sale_ord_no: sale_ord_no ? parseInt(sale_ord_no) : null,
        status: status || 'Scheduled',
      },
    });

    
    // If status is Posted, actual_yield was updated, propagate this change to Transactions
    if (currentPlan.status === 'Posted' && actual_yield !== undefined && parseFloat(actual_yield) !== currentPlan.actual_yield) {
      const newYield = parseFloat(actual_yield);
      if (!isNaN(newYield)) {
        // Find TransactionsMaster using tran_code = 8 (produced) and rmk5 = planId
        const txMaster = await prisma.transactionsMaster.findFirst({
          where: {
            tran_code: 8,
            rmk5: String(planId),
          },
        });

        if (txMaster) {
          // Update the corresponding Transactions where tran_id matches and itcd is finished_id
          await prisma.transactions.updateMany({
            where: {
              tran_id: txMaster.tran_id,
              itcd: parseInt(finished_id),
            },
            data: {
              qty: newYield,
            },
          });
        }
      }
    }

    const updatedMaster = await prisma.productionPlanMaster.findUnique({
      where: { id: planId },
      select: { id: true, barcode: true, dated: true, type: true },
    });

    if (updatedMaster && !updatedMaster.barcode) {
      await prisma.productionPlanMaster.update({
        where: { id: updatedMaster.id },
        data: {
          barcode: buildProductionBarcode({
            id: updatedMaster.id,
            dated: updatedMaster.dated,
            type: updatedMaster.type,
          }),
        },
      });
    }

    // Save change logs if any edits were tracked
    if (changeLogs && changeLogs.length > 0) {
      const changeLogData = changeLogs.map((log) => ({
        plan_id: planId,
        detail_id: log.detail_id || null,
        field_name: log.field_name,
        old_value: log.old_value,
        new_value: log.new_value,
        material_id: log.material_id ? parseInt(log.material_id) : null,
        material_desc: log.material_desc || null,
        changed_by: session?.user?.name || session?.user?.email || 'unknown',
        change_reason: log.change_reason || null,
      }));

      await prisma.productionPlanChangeLog.createMany({
        data: changeLogData,
      });
    }

    // Replace detail records
    await prisma.productionPlanDetail.deleteMany({ where: { plan_id: planId } });

    if (productionPlanDetail && productionPlanDetail.length > 0) {
      for (const mat of productionPlanDetail) {
        let materialId = null;
        if (mat.material_id) {
          const parsedId = parseInt(mat.material_id);
          if (!isNaN(parsedId)) materialId = parsedId;
        }

        await prisma.productionPlanDetail.create({
          data: {
            plan_id: planId,
            material_id: materialId,
            material_qty: parseFloat(mat.material_qty) || 0,
            material_percentage: parseFloat(mat.material_percentage) || 0,
            material_desc: mat.material_desc || '',
            sno: mat.sno || null,
          },
        });
      }
    }

    // Handle reprocessing materials for reprocessing type
    if (data.type === "reprocessing" && data.reprocessing_materials && data.reprocessing_materials.length > 0) {
      for (const mat of data.reprocessing_materials) {
        let materialId = null;
        if (mat.material_id) {
          const parsedId = parseInt(mat.material_id);
          if (!isNaN(parsedId)) materialId = parsedId;
        }
        await prisma.productionPlanDetail.create({
          data: {
            plan_id: planId,
            material_id: materialId,
            material_qty: parseFloat(mat.material_qty) || 0,
            material_percentage: 0,
            material_desc: mat.material_desc || '',
            sno: mat.sno || null,
          },
        });
      }
    }

    const updatedPlan = await prisma.productionPlanMaster.findUnique({
      where: { id: planId },
      include: {
        productionPlanDetail: { include: { item: true }, orderBy: { sno: 'asc' } },
        item: true,
        receipe: { include: { receipeDetails: true, item: true } },
        changeLogs: { orderBy: { changed_at: 'desc' }, take: 50 },
      },
    });

    const formattedUpdated = {
      id: updatedPlan.id,
      type: updatedPlan.type || 'new',
      receipe_id: updatedPlan.receipe_id,
      finished_id: updatedPlan.finished_id,
      productName: updatedPlan.item?.item || 'Unknown',
      dated: updatedPlan.dated?.toISOString().split('T')[0] || '',
      req_del_date: updatedPlan.req_del_date?.toISOString().split('T')[0] || '',
      batch_no: updatedPlan.batch_no || '',
      barcode: updatedPlan.barcode || '',
      sale_ord_no: updatedPlan.sale_ord_no || null,
      qty: updatedPlan.qty,
      actual_yield: updatedPlan.actual_yield || null,
      viscosity: updatedPlan.viscosity || '',
      machine_id: updatedPlan.machine_id || null,
      time_min: updatedPlan.time_min || null,
      bom_id: updatedPlan.bom_id || null,
      recipe: updatedPlan.receipe,
      status: updatedPlan.status,
      sent_to_production_date: updatedPlan.sent_to_production_date ? updatedPlan.sent_to_production_date.toISOString() : null,
      productionPlanDetail: updatedPlan.productionPlanDetail.map(detail => ({
        id: detail.id,
        material_id: detail.material_id,
        material_desc: detail.material_desc,
        material_percentage: detail.material_percentage,
        material_qty: detail.material_qty,
        sno: detail.sno || null,
        type: detail.material_percentage === 0 && detail.material_qty === 0 ? 'instruction' : 'material',
      })),
      reprocessing_materials: updatedPlan.type === "reprocessing"
        ? updatedPlan.productionPlanDetail.map((detail) => ({
            id: detail.id,
            material_id: detail.material_id,
            material_desc: detail.material_desc,
            material_qty: detail.material_qty,
            sno: detail.sno || null,
            type: detail.material_id ? "material" : "instruction",
          }))
        : [],
      changeLogs: updatedPlan.changeLogs?.map(log => ({
        id: log.id,
        field_name: log.field_name,
        old_value: log.old_value,
        new_value: log.new_value,
        material_id: log.material_id,
        material_desc: log.material_desc,
        changed_by: log.changed_by,
        changed_at: log.changed_at?.toISOString(),
        change_reason: log.change_reason,
      })) || [],
    };

    return NextResponse.json(formattedUpdated, { status: 200 });
  } catch (error) {
    console.error("Error updating production plan:", error);
    return NextResponse.json({ error: error.message }, { status: error.statusCode || 500 });
  }
});

export const DELETE = guard("materialInput.create", async (request, { params }) => {
  try {
    const planId = parseInt(params.id);

    const plan = await prisma.productionPlanMaster.findUnique({
      where: { id: planId },
      select: { dated: true, sent_to_production_date: true },
    });
    const lockError = await checkPeriodLock(
      [plan?.dated, plan?.sent_to_production_date],
      8,
      { action: "delete" },
    );
    if (lockError) {
      return NextResponse.json({ error: lockError }, { status: 422 });
    }

    await prisma.productionPlanChangeLog.deleteMany({ where: { plan_id: planId } });
    await prisma.productionPlanDetail.deleteMany({ where: { plan_id: planId } });
    await prisma.productionPlanMaster.delete({ where: { id: planId } });
    return NextResponse.json({}, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
