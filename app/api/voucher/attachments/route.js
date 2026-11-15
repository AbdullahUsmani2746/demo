// app/api/voucher/attachments/route.js
//
// Files attached to a document (TransactionsMaster.attachments) or to one of
// its lines (Transactions.attachments). Both columns hold public file URLs.
//
//   POST   form-data attachment=<file>[, attachment=<file>…]
//            + voucherId → appended to the document
//            + lineId    → appended to that line
//            neither     → upload only; the caller saves the returned URLs
//                          with the document (voucher forms do this)
//   GET    ?voucherId=   → { attachments, lines: [{ line_id, label, attachments }] }
//   DELETE ?voucherId=|lineId= &attachmentUrl=
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { uploadToSpaces } from '@/lib/space';
import { documentsScopeError } from '@/lib/auth/documentScope';

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Spaces keys go straight into the URL — keep them to safe characters.
const safeName = (name) =>
  String(name || 'file').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-120);

/**
 * Session + data scope. A line resolves to its document: another godown's
 * document (and its lines) is off limits.
 */
async function resolveTarget(voucherIdRaw, lineIdRaw) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { error: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  let voucherId = toId(voucherIdRaw);
  const lineId = toId(lineIdRaw);
  let line = null;

  if (lineId) {
    line = await prisma.transactions.findUnique({
      where: { id: lineId },
      select: { id: true, tran_id: true, attachments: true },
    });
    if (!line) {
      return { error: NextResponse.json({ success: false, error: 'Line not found' }, { status: 404 }) };
    }
    voucherId = line.tran_id;
  }

  if (voucherId) {
    const err = await documentsScopeError(session, prisma, [voucherId]);
    if (err) return { error: NextResponse.json({ success: false, error: err }, { status: 403 }) };
  }

  return { session, voucherId, lineId, line };
}

/** Readable label of a line for the viewer: item / account and its narration. */
function lineLabel(t) {
  const name =
    (t.itemDetails && [t.itemDetails.code, t.itemDetails.item].filter(Boolean).join(' - ')) ||
    t.acnoDetails?.acname ||
    t.serviceDetails?.service_name ||
    (t.acno ? `A/c ${t.acno}` : `Line ${t.id}`);
  const note = [t.narration1, t.narration2].filter(Boolean).join(' · ');
  return { name, note: note || null };
}

/**
 * POST /api/voucher/attachments
 */
export async function POST(req) {
  try {
    const formData = await req.formData();
    const target = await resolveTarget(formData.get('voucherId'), formData.get('lineId'));
    if (target.error) return target.error;

    const validFiles = formData.getAll('attachment').filter((f) => typeof f !== 'string');
    if (validFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid files uploaded' },
        { status: 400 }
      );
    }

    const uploadedUrls = [];
    const uploadErrors = [];

    for (const file of validFiles) {
      if (file.size > MAX_FILE_BYTES) {
        uploadErrors.push(`${file.name} is larger than 15 MB`);
        continue;
      }
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        uploadedUrls.push(await uploadToSpaces(buffer, safeName(file.name), file.type));
      } catch (uploadError) {
        console.error(`❌ Failed to upload ${file.name}:`, uploadError);
        uploadErrors.push(`Failed to upload ${file.name}`);
      }
    }

    if (uploadedUrls.length === 0) {
      return NextResponse.json(
        { success: false, error: uploadErrors[0] || 'All file uploads failed', details: uploadErrors },
        { status: 500 }
      );
    }

    let attachments = null;
    if (target.line) {
      const updated = await prisma.transactions.update({
        where: { id: target.line.id },
        data: { attachments: [...(target.line.attachments || []), ...uploadedUrls] },
        select: { attachments: true },
      });
      attachments = updated.attachments;
    } else if (target.voucherId) {
      const existing = await prisma.transactionsMaster.findUnique({
        where: { tran_id: target.voucherId },
        select: { attachments: true },
      });
      if (existing) {
        const updated = await prisma.transactionsMaster.update({
          where: { tran_id: target.voucherId },
          data: { attachments: [...(existing.attachments || []), ...uploadedUrls], last_sync: new Date() },
          select: { attachments: true },
        });
        attachments = updated.attachments;
      }
    }

    return NextResponse.json({
      success: true,
      paths: uploadedUrls,
      count: uploadedUrls.length,
      // The target's full list after the upload (null = upload only).
      attachments,
      errors: uploadErrors.length > 0 ? uploadErrors : undefined,
      voucher_updated: attachments !== null,
      message: `${uploadedUrls.length} file(s) uploaded successfully`,
    });
  } catch (error) {
    console.error('❌ Attachment upload error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Upload failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/voucher/attachments?voucherId=123
 * The document's own files and every line's.
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    if (!toId(searchParams.get('voucherId'))) {
      return NextResponse.json(
        { success: false, error: 'voucherId is required' },
        { status: 400 }
      );
    }

    const target = await resolveTarget(searchParams.get('voucherId'), null);
    if (target.error) return target.error;

    const voucher = await prisma.transactionsMaster.findUnique({
      where: { tran_id: target.voucherId },
      select: {
        attachments: true,
        tran_id: true,
        vr_no: true,
        transactions: {
          where: { attachments: { isEmpty: false } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            acno: true,
            narration1: true,
            narration2: true,
            attachments: true,
            itemDetails: { select: { item: true, code: true } },
            acnoDetails: { select: { acname: true } },
            serviceDetails: { select: { service_name: true } },
          },
        },
      },
    });

    if (!voucher) {
      return NextResponse.json(
        { success: false, error: 'Voucher not found' },
        { status: 404 }
      );
    }

    const lines = voucher.transactions.map((t) => ({
      line_id: t.id,
      ...lineLabel(t),
      attachments: t.attachments || [],
    }));
    const attachments = voucher.attachments || [];

    return NextResponse.json({
      success: true,
      data: {
        voucherId: voucher.tran_id,
        vrNo: voucher.vr_no,
        attachments,
        lines,
        count: attachments.length + lines.reduce((s, l) => s + l.attachments.length, 0),
      },
    });
  } catch (error) {
    console.error('❌ Get attachments error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch attachments' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/voucher/attachments?voucherId=|lineId=&attachmentUrl=
 * Unlinks the file from the document / line.
 */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const attachmentUrl = searchParams.get('attachmentUrl');
    const voucherIdRaw = searchParams.get('voucherId');
    const lineIdRaw = searchParams.get('lineId');

    if (!attachmentUrl || (!toId(voucherIdRaw) && !toId(lineIdRaw))) {
      return NextResponse.json(
        { success: false, error: 'voucherId or lineId, and attachmentUrl are required' },
        { status: 400 }
      );
    }

    const target = await resolveTarget(voucherIdRaw, lineIdRaw);
    if (target.error) return target.error;

    let remaining;
    if (target.line) {
      remaining = (target.line.attachments || []).filter((url) => url !== attachmentUrl);
      await prisma.transactions.update({
        where: { id: target.line.id },
        data: { attachments: remaining },
      });
    } else {
      const voucher = await prisma.transactionsMaster.findUnique({
        where: { tran_id: target.voucherId },
        select: { attachments: true },
      });
      if (!voucher) {
        return NextResponse.json(
          { success: false, error: 'Voucher not found' },
          { status: 404 }
        );
      }
      remaining = (voucher.attachments || []).filter((url) => url !== attachmentUrl);
      await prisma.transactionsMaster.update({
        where: { tran_id: target.voucherId },
        data: { attachments: remaining, last_sync: new Date() },
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Attachment removed successfully',
      attachments: remaining,
      remaining: remaining.length,
    });
  } catch (error) {
    console.error('❌ Delete error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Delete failed' },
      { status: 500 }
    );
  }
}
