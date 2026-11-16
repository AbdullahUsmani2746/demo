import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { guard } from '@/lib/auth/route';
import { checkPeriodLock } from '@/lib/periodLock';
import { recordScopeError } from '@/lib/auth/documentScope';
import { buildPosting, postPlan, assertIssueStock, postingDate } from '@/lib/manufacturing/processOrder';
import { feature } from '@/lib/features/server';
import { getProductionSetup, isFinishedCategory } from '@/lib/production/setup';
import { qcSendError } from '@/lib/quality/productionQc';

export const POST = guard('materialInput.create', async (request) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const planId = Number(body.productionPlanId);
    if (!Number.isSafeInteger(planId) || planId <= 0) {
      return NextResponse.json({ error: 'A valid production plan ID is required' }, { status: 400 });
    }

    // The vouchers' date: now, or the order's plan date (Settings → Features
    // "production.postingDate"). The period lock is checked for that date.
    const when = new Date();
    const stored = await prisma.productionPlanMaster.findUnique({ where: { id: planId }, select: { dated: true } });
    if (!stored) return NextResponse.json({ error: 'Production plan not found' }, { status: 404 });
    const dated = await postingDate(stored.dated, when);
    const lockError = await checkPeriodLock(dated, 8, { action: 'create' });
    if (lockError) return NextResponse.json({ error: lockError }, { status: 422 });

    // QC gate: Failed / On hold / Re-test never goes; with the feature
    // production.qcBeforeSend a finished-goods order needs QC Passed.
    const qcPlan = await prisma.productionPlanMaster.findUnique({
      where: { id: planId },
      select: { id: true, item: { select: { ic_id: true } }, qualityMaster: { select: { status: true } } },
    });
    const setup = await getProductionSetup();
    const qcError = await qcSendError(qcPlan, {
      requirePass: await feature('production.qcBeforeSend'),
      isFinished: (icId) => isFinishedCategory(setup, icId),
    });
    if (qcError) return NextResponse.json({ error: qcError }, { status: 422 });

    const result = await prisma.$transaction(async (tx) => {
      // Serialize posting for this plan. The status check and voucher writes
      // stay in the same transaction, so concurrent clicks cannot double-post.
      await tx.$queryRaw`SELECT id FROM "productionPlanMaster" WHERE id = ${planId} FOR UPDATE`;
      const plan = await tx.productionPlanMaster.findUnique({
        where: { id: planId },
        include: { productionPlanDetail: true, item: true },
      });
      if (!plan) {
        const error = new Error('Production plan not found');
        error.statusCode = 404;
        throw error;
      }
      if (plan.status === 'Posted') {
        const error = new Error('Production plan already sent to production');
        error.statusCode = 409;
        throw error;
      }

      const posting = await buildPosting(tx, plan, {
        actualYield: body.actualYield,
        actualYields: body.actualYields || {},
        adjustedItems: body.adjustedItems || {},
      });
      // Check every issue and output godown individually. An order spanning
      // several stores must not pass merely because one store is in scope.
      for (const godown of posting.godowns) {
        const scopeError = await recordScopeError(session, 'godown', [godown]);
        if (scopeError) {
          const error = new Error(scopeError);
          error.statusCode = 403;
          throw error;
        }
      }
      const activeGodowns = await tx.godown.findMany({
        where: { id: { in: posting.godowns }, is_active: true },
        select: { id: true },
      });
      if (activeGodowns.length !== posting.godowns.length) {
        const error = new Error('One or more production godowns are inactive. Choose active godowns and try again.');
        error.statusCode = 422;
        throw error;
      }
      // Stock check policy "processOrder" (Settings → Stock checking).
      const stockWarnings = await assertIssueStock(tx, posting);

      const posted = await postPlan(tx, plan, posting, {
        userId: session.user.id,
        m2m: plan.m2m,
        when,
        dated,
      });
      return { posted, posting, stockWarnings };
    }, { timeout: 30000, maxWait: 10000 });

    const { posted, posting, stockWarnings } = result;
    const totalMaterialQty = posting.issued.reduce((sum, line) => sum + line.qty, 0);
    const actualYield = posting.outputs.reduce((sum, line) => sum + line.qty, 0);
    return NextResponse.json({
      success: true,
      productionPlan: posted.updated,
      issueTransaction: { masters: posted.issueMasters, transactions: posting.issued.length },
      producedTransaction: {
        master: posted.producedMasters[0] || null,
        masters: posted.producedMasters,
        transactions: posting.outputs.length,
      },
      totals: { totalMaterialQty, actualYield, materialLoss: totalMaterialQty - actualYield },
      wastageApplied: {
        adjustedItemsCount: Object.keys(body.adjustedItems || {}).length,
        adjustedItems: body.adjustedItems || {},
      },
      warnings: stockWarnings,
    }, { status: 200 });
  } catch (error) {
    console.error('Error sending process order to production:', error);
    const status = error.statusCode || (error.code === 'P2025' ? 404 : 500);
    return NextResponse.json(
      { error: error.message || 'Failed to send process order to production' },
      { status },
    );
  }
});