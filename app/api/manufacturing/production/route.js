// /api/manufacturing/production

import { NextResponse } from "next/server";
import { buildProductionBarcode } from "@/lib/productionBarcode.js";
import { getServerSession } from 'next-auth'
import prisma from "@/lib/prisma";
import { authOptions } from '@/lib/auth';
import { resolveProductionGodown } from "@/lib/productionGodown";
import { getProductionSetup } from "@/lib/production/setup";
import { recordScopeError } from "@/lib/auth/documentScope";
import { guard } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";
import { feature } from "@/lib/features/server";
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { normalizeOrder, validateOrder, saveLines, effectiveOutputs, validateOrderReferences, buildPosting, postPlan, assertIssueStock, orderFeatureError, postingDate } from '@/lib/manufacturing/processOrder';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const sortBy = searchParams.get("sortBy") || "id";
  const sortOrder = searchParams.get("sortOrder") || "asc";
    const id = searchParams.get("id");
    const onlyWithBatch = searchParams.get("onlyWithBatch") === "true";
    const fetchOnlyid = searchParams.get("fetchOnlyid") === "true";

    try {
      const where = {};

      // Add batch_no NOT NULL filter only (for sticker page)
      if (onlyWithBatch) {
        where.batch_no = {
          not: null,
        };
      }

      if (search) {
        if (onlyWithBatch) {
          // For sticker page, search only in batch_no
          where.batch_no = {
            contains: search,
            mode: "insensitive",
            not: null,
          };
        } else {
          where.OR = [
            { item: { item: { contains: search, mode: "insensitive" } } },
            { barcode: { contains: search, mode: "insensitive" } },
            { batch_no: { contains: search, mode: "insensitive" } },
            { receipe: { item: {code: { contains: search, mode: "insensitive",},},},},
            {
              finished_id: {
                equals: isNaN(parseInt(search)) ? undefined : parseInt(search),
              },
            },
            {
              id: {
                equals: isNaN(parseInt(search)) ? undefined : parseInt(search),
              },
            },
          ];
        }
      }

      if (status) {
        where.status = status;
      }

      if (id) {
        where.id = parseInt(id);
      }

    const orderBy = { [sortBy]: sortOrder };

    const total = await prisma.productionPlanMaster.count({ where });
    const plans = await prisma.productionPlanMaster.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        item: true,
        receipe: { include: { receipeDetails: true, item: true } },
        productionPlanDetail: { include: { item: true, issueLine: true }, orderBy: [{ sno: 'asc' }, { id: 'asc' }] },
        outputs: { orderBy: { line_no: 'asc' } },
        changeLogs: { orderBy: { changed_at: 'desc' }, take: 20 },
        qualityMaster: { select: { status: true, batch_no: true } }, // QC gate on Send to Production
      },
    });

    // Code / name / unit / category of every production item (outputs carry
    // only the itcd). Plans without output rows read as one item = the master.
    const outputItcds = [...new Set(plans.flatMap((p) => (p.outputs || []).map((o) => o.finished_id)).filter(Boolean))];
    const outputItems = outputItcds.length
      ? await prisma.item.findMany({
          where: { itcd: { in: outputItcds } },
          select: { itcd: true, item: true, code: true, unit: true, ic_id: true },
        })
      : [];
    const outputItemOf = new Map(outputItems.map((i) => [i.itcd, i]));
    // Settings → Production setup: default output / issue godowns
    const setup = await getProductionSetup();

    const saleOrderNos = plans
      .map((p) => p.sale_ord_no)
      .filter((no) => no !== null && no !== undefined);

    const orderMasters = saleOrderNos.length > 0
      ? await prisma.orderMaster.findMany({
          where: { order_no: { in: saleOrderNos } },
          include: { acno: { select: { acname: true } } },
        })
      : [];

    const customerMap = {};
    orderMasters.forEach((om) => {
      if (om.acno?.acname) {
        customerMap[om.order_no] = om.acno.acname;
      }
    });

    const formatted = plans.map((plan) => ({
      id: plan.id,
      type: plan.type,
      receipe_id: plan.receipe_id,
      finished_id: plan.finished_id,
      productName: plan.item?.item || "Unknown",
      productCategory: plan?.item?.ic_id,
      dated: plan.dated?.toISOString().split("T")[0] || "",
      req_del_date: plan.req_del_date?.toISOString().split("T")[0] || "",
      batch_no: plan.batch_no || "",
      barcode: plan.barcode || "",
      sale_ord_no: plan.sale_ord_no || null,
      customer_name: plan.sale_ord_no ? (customerMap[plan.sale_ord_no] || null) : null,
      qty: plan.qty,
      actual_yield: plan.actual_yield || null,
      req_no: plan.req_no || null,
      viscosity: plan.viscosity || "",
      machine_id: plan.machine_id || null,
      time_min: plan.time_min || null,
      bom_id: plan.bom_id || null,
      recipe: plan.receipe,
      status: plan.status || "Scheduled",
      sent_to_production_date: plan.sent_to_production_date ? plan.sent_to_production_date.toISOString() : null,
      machine_name: plan.machine?.descr || "Unknown",
      material_sample: String(plan.item?.alternate_id) || "",
      m2m: !!plan.m2m,
      outputs: effectiveOutputs(
        plan,
        (plan.outputs || []).map((output) => ({ ...output, item: outputItemOf.get(output.finished_id) || null })),
        setup,
      ),
      productionPlanDetail: plan.productionPlanDetail.map((detail) => ({
        id: detail.id,
        material_id: detail.material_id,
        material_desc: detail.material_desc,
        material_code: detail.item?.code || null,
        material_percentage: detail.material_percentage,
        material_qty: detail.material_qty,
        sno: detail.sno || null,
        output_line: detail.issueLine?.output_line || 1,
        issue_godown: detail.material_id ? detail.issueLine?.godown ?? setup.productionGodown : null,
        issue_unit: detail.issueLine?.unit || 'KG',
        item: detail.item ? {
          itcd: detail.item.itcd,
          item: detail.item.item,
          code: detail.item.code,
          wastage_percentage: detail.item.wastage_percentage,
        } : null,
      })),
      changeLogs: (plan.changeLogs || []).map((log) => ({
        id: log.id,
        field_name: log.field_name,
        old_value: log.old_value,
        new_value: log.new_value,
        material_id: log.material_id,
        material_desc: log.material_desc,
        changed_by: log.changed_by,
        changed_at: log.changed_at?.toISOString(),
      })),
      reprocessing_materials: plan.type === "reprocessing"
        ? plan.productionPlanDetail.map((detail) => ({
            id: detail.id,
            material_id: detail.material_id,
            material_desc: detail.material_desc,
            material_code: detail.item?.code || null,
            material_qty: detail.material_qty,
            sno: detail.sno || null,
        output_line: detail.issueLine?.output_line || 1,
        issue_godown: detail.material_id ? detail.issueLine?.godown ?? setup.productionGodown : null,
        issue_unit: detail.issueLine?.unit || 'KG',
            type: detail.material_id ? "material" : "instruction",
          }))
        : [],
    }));

    const proceeOrderIds = await prisma.productionPlanMaster.findMany({
      select: { id: true },
      where: { status: "Posted" },
    })

    return NextResponse.json({ data: fetchOnlyid ? proceeOrderIds : formatted, total }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const POST = guard("materialInput.create", async (request) => {

  try {
    const session = await getServerSession(authOptions)


    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const data = await request.json();
    // Settings → Features (production.processOrderSource): when process orders
    // are made from recipes, a new one must name an active recipe.
    const recipeMode = data.type === "new" && (await feature("production.processOrderSource")) === "recipe";
    if (recipeMode) {
      const receipeId = Number(data.receipe_id);
      const recipe = Number.isInteger(receipeId) && receipeId > 0
        ? await prisma.rECEIPE_MASTER.findUnique({ where: { receipe_id: receipeId }, select: { finished_id: true, status: true } })
        : null;
      if (!recipe) {
        return NextResponse.json({ error: "Choose the recipe — new process orders are made from a recipe (Settings → Features)." }, { status: 422 });
      }
      const firstItem = Number(data.outputs?.[0]?.finished_id ?? data.finished_id);
      if (firstItem && recipe.finished_id !== firstItem) {
        return NextResponse.json({ error: "The recipe is for another item than the first production item." }, { status: 422 });
      }
    }
    // Process Order screen: one or more production items, each with its own
    // issuances (lib/manufacturing/processOrder.js). "new" is saved as
    // Completed and posted by Send to Production; "reprocessing" posts its
    // tran_code 7 + 8 right away, in the same transaction.
    if (Array.isArray(data.outputs) && (data.type === "new" || data.type === "reprocessing")) {
      const orderType = data.type;
      const order = normalizeOrder(data);
      const errors = validateOrder(order);
      if (errors.length) {
        return NextResponse.json({ error: errors.join("; ") }, { status: 422 });
      }
      // Settings → Features: one production item per order / a BOM on every item
      const featureError = await orderFeatureError(order, { type: orderType, recipeMode });
      if (featureError) return NextResponse.json({ error: featureError }, { status: 422 });
      if (!data.dated || Number.isNaN(new Date(data.dated).getTime())) {
        return NextResponse.json({ error: "Plan date is required" }, { status: 400 });
      }
      // Reprocessing posts at once: its vouchers' date ("production.postingDate") is lock-checked too.
      // Settings → Features "processOrder.batchRequiredReprocessing": a reprocessing
      // order saved with "Wait for Send to Production" (batch_required) is saved like
      // a new order and posts only on Send to Production.
      const waitForSend = orderType === "reprocessing" && data.batch_required === true
        && (await feature("processOrder.batchRequiredReprocessing"));
      const postsNow = orderType === "reprocessing" && !waitForSend;
      const sentAt = new Date();
      const postOn = postsNow ? await postingDate(data.dated, sentAt) : null;
      const lockError = await checkPeriodLock(postOn ? [data.dated, postOn] : data.dated, 8, { action: "create" });
      if (lockError) return NextResponse.json({ error: lockError }, { status: 422 });

      const referenceCheck = await validateOrderReferences(order);
      if (referenceCheck.error) return NextResponse.json({ error: referenceCheck.error }, { status: 422 });
      for (const godown of referenceCheck.godowns) {
        const scopeError = await recordScopeError(session, "godown", [godown]);
        if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });
      }
      const first = order.outputs[0];
      const stockWarnings = [];
      const result = await prisma.$transaction(async (tx) => {
        const master = await tx.productionPlanMaster.create({
          data: {
            type: orderType,
            receipe_id: data.receipe_id ? Number(data.receipe_id) : null,
            finished_id: first.finished_id,
            bom_id: first.bom_id,
            qty: first.qty,
            dated: new Date(data.dated),
            req_del_date: data.req_del_date ? new Date(data.req_del_date) : null,
            batch_no: first.batch_no,
            machine_id: data.machine_id ? Number(data.machine_id) : null,
            time_min: data.time_min ? Number(data.time_min) : null,
            actual_yield: first.actual_yield,
            viscosity: data.viscosity || null,
            m2m: Boolean(data.m2m),
            req_no: data.req_no ? Number(data.req_no) : null,
            sale_ord_no: data.sale_ord_no ? Number(data.sale_ord_no) : null,
            batch_required: Boolean(waitForSend),
            status: "Completed",
          },
        });
        const barcode = buildProductionBarcode({ id: master.id, dated: data.dated, type: orderType });
        await tx.productionPlanMaster.update({ where: { id: master.id }, data: { barcode } });
        await saveLines(tx, master.id, order);
        if (postsNow) {
          const plan = await tx.productionPlanMaster.findUnique({
            where: { id: master.id },
            include: { productionPlanDetail: true, item: true },
          });
          const posting = await buildPosting(tx, plan);
          // Stock check policy "processOrder" (Settings → Stock checking).
          stockWarnings.push(...(await assertIssueStock(tx, posting)));
          await postPlan(tx, plan, posting, { userId: session.user.id, m2m: plan.m2m, when: sentAt, dated: postOn });
        }
        return tx.productionPlanMaster.findUnique({
          where: { id: master.id },
          include: {
            item: true,
            outputs: { orderBy: { line_no: "asc" } },
            productionPlanDetail: { include: { item: true, issueLine: true }, orderBy: { sno: "asc" } },
          },
        });
      }, { timeout: 30000, maxWait: 10000 });

      return NextResponse.json({
        ...result,
        outputs: result.outputs,
        productionPlanDetail: result.productionPlanDetail.map((detail) => ({
          ...detail,
          output_line: detail.issueLine?.output_line || 1,
          issue_godown: detail.issueLine?.godown ?? null,
          issue_unit: detail.issueLine?.unit || "KG",
        })),
        warnings: stockWarnings,
      }, { status: 201 });
    }
    const {
      type, // "new", "sf", "reprocessing"
  receipe_id,
  finished_id,
  qty,
  dated,
  req_del_date,
  batch_no,
  sale_ord_no,
  req_no,
  actual_yield,
  viscosity,
  m2m,
  machine_id,
  time_min,
  bom_id,
  productionPlanDetail,
  reprocessing_materials,
} = data;




    // Validate required fields based on type
    if (type === "new" && !bom_id && !recipeMode) {
      return NextResponse.json(
        { error: "BOM ID is required for new production" },
        { status: 400 },
      );
    }

    if (!finished_id) {
      return NextResponse.json(
        { error: "Finished product ID is required" },
        { status: 400 },
      );
    }

    if (!qty || qty <= 0) {
      return NextResponse.json(
        { error: "Valid production quantity is required" },
        { status: 400 },
      );
    }

    if (!dated) {
        return NextResponse.json(
            { error: "Plan date is required" },
            { status: 400 },
        );
    }

    // Period lock validation — SF / reprocessing post at once, dated as
    // Settings → Features "production.postingDate" says.
    const legacyPostOn = (type === "sf" || type === "reprocessing") ? await postingDate(dated) : null;
    const lockError = await checkPeriodLock(legacyPostOn ? [dated, legacyPostOn] : dated, 8, { action: "create" });
    if (lockError) {
        return NextResponse.json({ error: lockError }, { status: 422 });
    }

    // SF / reprocessing post a material issue (7) and a production (8) below.
    // Their quantity lines carry each item's stock account (category
    // stock_acno → 'stock' Account Settings default) — resolved before the
    // plan is saved, so a missing account refuses it (422) instead of leaving
    // a posted plan with no vouchers.
    let issueAcno = {};
    let producedAcno = {};
    if (type === "sf" || type === "reprocessing") {
      // Reprocessing issues BOTH its reprocessing materials and every plan
      // detail row, so both must resolve — otherwise a detail item would post
      // its issue line with no account.
      const issueSource = type === "sf"
        ? productionPlanDetail
        : [...(reprocessing_materials || []), ...(productionPlanDetail || [])];
      const issueLines = (issueSource || []).map((mat) => ({ itcd: parseInt(mat.material_id) }));
      ({ lineAcno: issueAcno } = await resolveItemAccounts(issueLines, 7));
      ({ lineAcno: producedAcno } = await resolveItemAccounts([{ itcd: parseInt(finished_id) }], 8));
    }

    // Create master record with type
    const master = await prisma.productionPlanMaster.create({
      data: {
        type: type || "new", // Store the production type
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
        m2m: m2m,
        req_no: req_no ? parseInt(req_no) : null,
        sale_ord_no: sale_ord_no ? parseInt(sale_ord_no) : null,
        status: (type === "sf" || type === "reprocessing") ? "Posted" : "Completed", // SF/Reprocessing go directly to Posted, New goes to Completed
      },
    });

    const generatedBarcode = buildProductionBarcode({
      id: master.id,
      dated,
      type: type || "new",
    });

    await prisma.productionPlanMaster.update({
      where: { id: master.id },
      data: {
        barcode: generatedBarcode,
      },
    });



    // Handle production plan details (materials + instructions)
    if (productionPlanDetail && productionPlanDetail.length > 0) {
      const detailPromises = productionPlanDetail.map(async (mat) => {
        // Convert material_id to integer - handle both numeric and string instruction IDs
        let materialId = null;

        if (mat.material_id) {
          // Try to parse as integer
          const parsedId = parseInt(mat.material_id);
          if (!isNaN(parsedId)) {
            materialId = parsedId;
          } else {
            // If it's a string that can't be parsed, you might want to handle it differently
            // For now, we'll store it as null, but you could create a mapping system
            console.warn("Non-numeric material_id:", mat.material_id);
          }
        }

        return prisma.productionPlanDetail.create({
          data: {
            plan_id: master.id,
            material_id: materialId,
            material_qty: parseFloat(mat.material_qty) || 0,
            material_percentage: parseFloat(mat.material_percentage) || 0,
            material_desc: mat.material_desc || "",
            sno: mat.sno || null,
          },
        });
      });

      await Promise.all(detailPromises);


    }

    // Handle reprocessing materials for reprocessing type
    if (
      type === "reprocessing" &&
      reprocessing_materials &&
      reprocessing_materials.length > 0
    ) {
      const reprocessingPromises = reprocessing_materials.map(async (mat) => {
        let materialId = null;

        if (mat.material_id) {
          const parsedId = parseInt(mat.material_id);
          if (!isNaN(parsedId)) {
            materialId = parsedId;
          }
        }

        return prisma.productionPlanDetail.create({
          data: {
            plan_id: master.id,
            material_id: materialId,
            material_qty: parseFloat(mat.material_qty) || 0,
            material_percentage: 0, // Reprocessing materials don't have percentages
            material_desc: mat.material_desc || "",
            sno: mat.sno || null,
          },
        });
      });

      await Promise.all(reprocessingPromises);


    }

    // For SF to FG, automatically create transaction entries
    if (type === "sf") {
      try {



        // Vouchers dated as "production.postingDate" says; sent = now.
        const sentAt = new Date();
        const currentDate = legacyPostOn || sentAt;
        // Settings → Production setup: finished output goes where its item
        // category says (finished goods → FG godown, else the production
        // godown). Materials are ALWAYS consumed out of the production godown
        // — issuing them from the FG godown drove that store's raw-material
        // and semi-finished balances negative.
        const setup = await getProductionSetup();
        const productionGodown = await resolveProductionGodown(prisma, finished_id, setup);
        const godownForSF = productionGodown;   // finished goods in
        const godownForPF = setup.productionGodown;     // materials issued out

        // Data scope (Admin → Permissions): one of the two must be the user's.
        const sfScopeError = await recordScopeError(session, "godown", [godownForPF, godownForSF]);
        if (sfScopeError) {
          return NextResponse.json({ error: sfScopeError }, { status: 403 });
        }

        // Get production details for transaction
        const productionDetails = await prisma.productionPlanDetail.findMany({
          where: { plan_id: master.id },
        });


        productionDetails.forEach((detail, idx) => {

        });

        // 1. Create Transaction Master for MATERIAL ISSUED (tran_code 7)
        const lastIssueVoucher = await prisma.transactionsMaster.findFirst({
          where: {
            dated: {
              gte: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()),
              lt: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1),
            },
            tran_code: 7,
            vr_no: { not: null }, // unnumbered vouchers would sort first (NULL first in DESC)
          },
          orderBy: { vr_no: 'desc' },
        });

        const issueVrNo = lastIssueVoucher ? lastIssueVoucher.vr_no + 1 : 1;

   const issueTransactionMaster = await prisma.transactionsMaster.create({
  data: {
    company_id: 1,
    dated: currentDate,
    time: currentDate,
    tran_code: 7,
    vr_no: issueVrNo,
    godown: godownForPF,
    rmk: `Material issued for SF to FG production order no: ${master.id}`,
    rmk4: master.m2m ? "M2M" : null,
    rmk5: String(master.id),
    user_id: session.user.id,
  },
});

        // 2. Create Transaction Master for MATERIAL PRODUCED (tran_code 8)
        const lastProducedVoucher = await prisma.transactionsMaster.findFirst({
          where: {
            dated: {
              gte: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()),
              lt: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1),
            },
            tran_code: 8,
            vr_no: { not: null }, // unnumbered vouchers would sort first (NULL first in DESC)
          },
          orderBy: { vr_no: 'desc' },
        });

        const producedVrNo = lastProducedVoucher ? lastProducedVoucher.vr_no + 1 : 1;

   const producedTransactionMaster = await prisma.transactionsMaster.create({
  data: {
    company_id: 1,
    dated: currentDate,
    time: currentDate,
    tran_code: 8,
    vr_no: producedVrNo,
    godown: godownForSF,
    rmk: `Material produced from SF to FG order no: ${master.id}`,
    rmk4: master.m2m ? "M2M" : null,
    rmk5: String(master.id),
    user_id: session.user.id,
  },
});

        // 3. Calculate totals
        const totalMaterialQty = productionDetails
          .filter(item => item.material_percentage > 0)
          .reduce((sum, material) => sum + (parseFloat(material.material_qty) || 0), 0);

        const finalActualYield = parseFloat(actual_yield) || parseFloat(qty) || 0;

        // 4. Create transactions for MATERIAL ISSUED
        const issueTransactions = [];

        productionDetails
          .filter(item => item.material_id !== null && item.material_percentage > 0)
          .forEach(material => {
            issueTransactions.push({
              tran_id: issueTransactionMaster.tran_id,
              acno: issueAcno[material.material_id] ?? null,
              itcd: material.material_id,
              qty: material.material_qty,
              damt: 0,
              camt: 0,
              narration1: `Material issued for SF to FG production ${master.id}`,
              narration2: material.material_desc,
              unit: 'KG',
              godown: godownForPF,
            });
          });

        // CREDIT: Material Process Loss (if any)
        const materialLoss = totalMaterialQty - finalActualYield;
        // if (materialLoss > 0) {
        //   issueTransactions.push({
        //     tran_id: issueTransactionMaster.tran_id,
        //     acno: 3,
        //     itcd: null,
        //     qty: materialLoss,
        //     damt: 0,
        //     camt: 0,
        //     narration1: `Process loss for SF to FG production ${master.id}`,
        //     narration2: `Difference: ${totalMaterialQty.toFixed(2)} - ${finalActualYield.toFixed(2)}`,
        //     unit: 'KG',
        //     godown: godownForSF,
        //   });
        // }

        // 5. Create transactions for MATERIAL PRODUCED
        const producedTransactions = [];

        producedTransactions.push({
          tran_id: producedTransactionMaster.tran_id,
          acno: producedAcno[parseInt(finished_id)] ?? null,
          itcd: parseInt(finished_id),
          qty: finalActualYield,
          damt: 0,
          camt: 0,
          narration1: `Production of finished goods - ${finished_id}`,
          narration2: `SF to FG Process Order: ${master.id}`,
          unit: 'KG',
          godown: godownForSF,
        });

        // 6. Create all transactions

        if (issueTransactions.length > 0) {
          await prisma.transactions.createMany({
            data: issueTransactions,
          });

        }


        if (producedTransactions.length > 0) {
          await prisma.transactions.createMany({
            data: producedTransactions,
          });

        }

        // 7. Update production plan with transaction IDs
        await prisma.productionPlanMaster.update({
          where: { id: master.id },
          data: {
            transaction_id: producedTransactionMaster.tran_id,
            sent_to_production_date: sentAt,
            status: 'Posted'
          },
        });

        // 8. Auto-create FG_TRANSFER requisition (Production Floor → FG Dept)
        // FG department will accept this to acknowledge receipt of finished goods.
        await prisma.reqMaster.create({
          data: {
            userid:       session.user.id,
            dated:        currentDate,
            req_catagory: 'FG_TRANSFER',
            issued_by:    setup.productionGodown,   // Settings → Production setup
            issued_for:   setup.fgTransferGodown,   // "FG transfer to"
            status:       'Pending',
            plan_id:      master.id,
            details: {
              create: [{
                itcd:   parseInt(finished_id),
                qty:    finalActualYield,
                ap_qty: null,
              }],
            },
          },
        });

      } catch (txError) {
        console.error("❌ Error creating transactions:", txError.message);
        console.error("Transaction error details:", txError);
      }
    }

    // For Reprocessing, automatically create transaction entries (same as SF but godown 2)
    if (type === "reprocessing") {
      try {
        // Vouchers dated as "production.postingDate" says; sent = now.
        const sentAt = new Date();
        const currentDate = legacyPostOn || sentAt;
        // Settings → Production setup: output godown from the item's category,
        // materials out of the production godown.
        const setup = await getProductionSetup();
        const godownForReprocessing = await resolveProductionGodown(prisma, finished_id, setup); // output
        const godownForReprocessingIssue = setup.productionGodown;                                // materials out of production

        // Data scope (Admin → Permissions): one of the two must be the user's.
        const rpScopeError = await recordScopeError(session, "godown", [godownForReprocessingIssue, godownForReprocessing]);
        if (rpScopeError) {
          return NextResponse.json({ error: rpScopeError }, { status: 403 });
        }

        // Get all saved reprocessing materials
        const reprocessingDetails = await prisma.productionPlanDetail.findMany({
          where: { plan_id: master.id },
        });

        // 1. Create Transaction Master for MATERIAL ISSUED (tran_code 7)
        const lastIssueVoucher = await prisma.transactionsMaster.findFirst({
          where: {
            dated: {
              gte: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()),
              lt: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1),
            },
            tran_code: 7,
            vr_no: { not: null }, // unnumbered vouchers would sort first (NULL first in DESC)
          },
          orderBy: { vr_no: 'desc' },
        });

        const issueVrNo = lastIssueVoucher ? lastIssueVoucher.vr_no + 1 : 1;

        const issueTransactionMaster = await prisma.transactionsMaster.create({
          data: {
            company_id: 1,
            dated: currentDate,
            time: currentDate,
            tran_code: 7,
            vr_no: issueVrNo,
            godown: godownForReprocessingIssue,
            rmk: `Material issued for Reprocessing order no: ${master.id}`,
                rmk4: master.m2m ? "M2M" : null,
            rmk5: String(master.id),
            user_id: session.user.id,
        
          },
        });

        // 2. Create Transaction Master for MATERIAL PRODUCED (tran_code 8)
        const lastProducedVoucher = await prisma.transactionsMaster.findFirst({
          where: {
            dated: {
              gte: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()),
              lt: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1),
            },
            tran_code: 8,
            vr_no: { not: null }, // unnumbered vouchers would sort first (NULL first in DESC)
          },
          orderBy: { vr_no: 'desc' },
        });

        const producedVrNo = lastProducedVoucher ? lastProducedVoucher.vr_no + 1 : 1;

        const producedTransactionMaster = await prisma.transactionsMaster.create({
          data: {
            company_id: 1,
            dated: currentDate,
            time: currentDate,
            tran_code: 8,
            vr_no: producedVrNo,
            godown: godownForReprocessing,
            rmk: `Material produced from Reprocessing order no: ${master.id}`,
            rmk4: master.m2m ? "M2M" : null,
            rmk5: String(master.id),
            user_id: session.user.id,
          },
        });

        // 3. Calculate totals
        const totalMaterialQty = reprocessingDetails
          .filter(item => item.material_id !== null)
          .reduce((sum, material) => sum + (parseFloat(material.material_qty) || 0), 0);

        const finalActualYield = parseFloat(actual_yield) || parseFloat(qty) || 0;

        // 4. Create transactions for MATERIAL ISSUED
        const issueTransactions = [];

        reprocessingDetails
          .filter(item => item.material_id !== null)
          .forEach(material => {
            issueTransactions.push({
              tran_id: issueTransactionMaster.tran_id,
              acno: issueAcno[material.material_id] ?? null,
              itcd: material.material_id,
              qty: material.material_qty,
              damt: 0,
              camt: 0,
              narration1: `Material issued for Reprocessing ${master.id}`,
              narration2: material.material_desc,
              unit: 'KG',
              godown: godownForReprocessingIssue,
            });
          });

        // Process loss (if any)
        const materialLoss = totalMaterialQty - finalActualYield;
        // if (materialLoss > 0) {
        //   issueTransactions.push({
        //     tran_id: issueTransactionMaster.tran_id,
        //     acno: 3,
        //     itcd: null,
        //     qty: materialLoss,
        //     damt: 0,
        //     camt: 0,
        //     narration1: `Process loss for Reprocessing ${master.id}`,
        //     narration2: `Difference: ${totalMaterialQty.toFixed(2)} - ${finalActualYield.toFixed(2)}`,
        //     unit: 'KG',
        //     godown: godownForReprocessing,
        //   });
        // }

        // 5. Create transactions for MATERIAL PRODUCED
        const producedTransactions = [{
          tran_id: producedTransactionMaster.tran_id,
          acno: producedAcno[parseInt(finished_id)] ?? null,
          itcd: parseInt(finished_id),
          qty: finalActualYield,
          damt: 0,
          camt: 0,
          narration1: `Production of finished goods - ${finished_id}`,
          narration2: `Reprocessing Order: ${master.id}`,
          unit: 'KG',
          godown: godownForReprocessing,
        }];

        // 6. Create all transactions
        if (issueTransactions.length > 0) {
          await prisma.transactions.createMany({ data: issueTransactions });
        }

        if (producedTransactions.length > 0) {
          await prisma.transactions.createMany({ data: producedTransactions });
        }

        // 7. Update production plan with transaction IDs
        await prisma.productionPlanMaster.update({
          where: { id: master.id },
          data: {
            transaction_id: producedTransactionMaster.tran_id,
            sent_to_production_date: sentAt,
            status: 'Posted'
          },
        });

        // 8. Auto-create FG_TRANSFER requisition (Production Floor → FG Dept)
        // await prisma.reqMaster.create({
        //   data: {
        //     userid:       session.user.id,
        //     dated:        currentDate,
        //     req_catagory: 'FG_TRANSFER',
        //     issued_by:    2,        // Production floor (godown 2)
        //     issued_for:   1,        // FG department / main warehouse (adjust godown id as needed)
        //     status:       'Pending',
        //     plan_id:      master.id,
        //     details: {
        //       create: [{
        //         itcd:   parseInt(finished_id),
        //         qty:    finalActualYield,
        //         ap_qty: null,
        //       }],
        //     },
        //   },
        // });

      } catch (txError) {
        console.error("❌ Error creating reprocessing transactions:", txError.message);
        console.error("Reprocessing transaction error details:", txError);
      }
    }

    const newPlan = await prisma.productionPlanMaster.findUnique({
      where: { id: master.id },
      include: {
        productionPlanDetail: {
          include: {
            item: true,
          },
          orderBy: {
            sno: "asc",
          },
        },
        item: true,
        receipe: {
          include: {
            receipeDetails: true,
          },
        },
        bomMaster: true,
      },
    });

    let customerName = null;
    if (newPlan.sale_ord_no) {
      const orderMaster = await prisma.orderMaster.findUnique({
        where: { order_no: newPlan.sale_ord_no },
        include: { acno: { select: { acname: true } } },
      });
      customerName = orderMaster?.acno?.acname || null;
    }

    // Format the response to match your frontend structure
    const formattedNew = {
      id: newPlan.id,
      type: newPlan.type || "new",
      receipe_id: newPlan.receipe_id,
      finished_id: newPlan.finished_id,
      productName: newPlan.item?.item || "Unknown",
      dated: newPlan.dated?.toISOString().split("T")[0] || "",
      req_del_date: newPlan.req_del_date?.toISOString().split("T")[0] || "",
      batch_no: newPlan.batch_no || "",
      barcode: newPlan.barcode || generatedBarcode,
      sale_ord_no: newPlan.sale_ord_no || null,
      customer_name: customerName,
      qty: newPlan.qty,
      actual_yield: newPlan.actual_yield || null,
      viscosity: newPlan.viscosity || "",
      machine_id: newPlan.machine_id || null,
      time_min: newPlan.time_min || null,
      bom_id: newPlan.bom_id || null,
      status: newPlan.status,
      productionPlanDetail: newPlan.productionPlanDetail.map((detail) => ({
        material_id: detail.material_id,
        material_desc: detail.material_desc,
        material_percentage: detail.material_percentage,
        material_qty: detail.material_qty,
        sno: detail.sno || null,
        output_line: detail.issueLine?.output_line || 1,
        issue_godown: detail.issueLine?.godown ?? null,
        issue_unit: detail.issueLine?.unit || 'KG',
        type:
          detail.material_percentage === 0 && detail.material_qty === 0
            ? "instruction"
            : "material",
      })),
      reprocessing_materials:
        type === "reprocessing"
          ? newPlan.productionPlanDetail
            .filter((detail) => detail.material_percentage === 0)
            .map((detail) => ({
              material_id: detail.material_id,
              material_desc: detail.material_desc,
              material_qty: detail.material_qty,
              sno: detail.sno || null,
        output_line: detail.issueLine?.output_line || 1,
        issue_godown: detail.issueLine?.godown ?? null,
        issue_unit: detail.issueLine?.unit || 'KG',
              type: "material",
            }))
          : [],
    };




    return NextResponse.json(formattedNew, { status: 201 });
  } catch (error) {
    console.error("❌ Error creating production plan:", error);
    if (error?.statusCode) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      {
        error: error.message,
        details: "Failed to create production plan",
      },
      { status: 500 },
    );
  }
});
