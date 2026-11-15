import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getAccountVisibilitySession } from '@/lib/accounts/visibility';
import { guard } from "@/lib/auth/route";
import { getAccountGroups } from "@/lib/accounts/accountSettings";

export async function GET(request) {
  try {

     // Get the bscd query parameter from the URL
    const { searchParams } = new URL(request.url);
    const bscd = searchParams.get('bscd');
    const macnoParam = searchParams.get('macno');

    const includeInactiveParam = searchParams.get('includeInactive') === 'true';

    const { allowed } = await getAccountVisibilitySession();
    const includeInactive = includeInactiveParam && allowed;

    // Construct where clause based on bscd parameter.
    // NOTE: this used to spread `...(macno ? { macno: Number(macno) } : {})`,
    // but no `macno` variable exists here — the query param is read into
    // `macnoParam` above. That was a ReferenceError on EVERY request, so this
    // endpoint always returned 500 and the "Main Account" dropdown inside the
    // add-account modal could never load. The macnoParam block below is the
    // real filter and already handles single and comma-separated values.
    const where = {
      ...(bscd ? { bscd: parseInt(bscd) } : {}),
      // ...(includeInactive ? {} : { isActive: true }),
    };

 // Case 1 or 2: macno and / or a named group from Finance → Account
    // Settings (?group=lc_accounts,beneficiaries), resolved here so no screen
    // carries a macno number. A group nobody has configured lists nothing.
    const groupKeys = (searchParams.get('group') || '').split(',').map(g => g.trim()).filter(Boolean);
    if (macnoParam || groupKeys.length) {
      const macnos = [
        ...(macnoParam || '').split(',').map(m => parseInt(m.trim(), 10)).filter(m => !Number.isNaN(m)),
        ...(groupKeys.length ? await getAccountGroups(groupKeys) : []),
      ];
      where.macno = { in: [...new Set(macnos)] };
    }

    const macnos = await prisma.mACNO.findMany({
    //   include: {
    //     businessCat: true,
    //     acnos: true,
    //   },
    //   orderBy: {
    //     macno: 'asc',
    //   },
      where
    });
    
    return NextResponse.json({data:macnos, status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch MACNO data' },
      { status: 500 }
    );
  }
}

export const POST = guard("account.manage", async (request) => {
  try {
    const { macname, bscd } = await request.json();
    

    // Validate input
    if (!macname || !bscd) {
      return NextResponse.json(
        { error: 'macno, macname, and bscd are required' },
        { status: 400 }
      );
    }

    // Check if parent BSCD exists
    const parentExists = await prisma.bSCD.findUnique({
      where: { bscd: Number(bscd) },
    });

    if (!parentExists) {
      return NextResponse.json(
        { error: 'Parent BSCD does not exist' },
        { status: 400 }
      );
    }

    const newMacno = await prisma.mACNO.create({
      data: {
        macname,
        bscd: Number(bscd),   
      },
    //   include: {
    //     businessCat: true,
    //   },
    });

    return NextResponse.json({data:newMacno, status: 201 });
  } catch (error) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: `MACNO code already exists ${error}`},
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `Failed to create MACNO ${error}` },
      { status: 500 }
    );
  }
});

// PUT update MACNO
export const PUT = guard("account.manage", async (request) => {
  try {
    const { macno, macname, bscd } = await request.json();
    

    if (!macno || !macname || !bscd) {
      return NextResponse.json(
        { error: 'macno, macname, and bscd are required' },
        { status: 400 }
      );
    }

    const parentExists = await prisma.bSCD.findUnique({
      where: { bscd },
    });

    if (!parentExists) {
      return NextResponse.json(
        { error: 'Parent BSCD does not exist' },
        { status: 400 }
      );
    }

    const updatedMacno = await prisma.mACNO.update({
      where: { macno },
      data: { macname, bscd },
    });

    return NextResponse.json({ data: updatedMacno, status: 200 });
  } catch (error) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'MACNO not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Failed to update MACNO' },
      { status: 500 }
    );
  }
});

// DELETE MACNO using query param (?code=XYZ)
export const DELETE = guard("account.manage", async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const macno = searchParams.get('code');

    if (!macno) {
      return NextResponse.json(
        { error: 'Query parameter "code" is required' },
        { status: 400 }
      );
    }

    await prisma.mACNO.delete({ where: { macno } });

    return NextResponse.json({ message: 'MACNO deleted successfully', status: 200 });
  } catch (error) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'MACNO not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Failed to delete MACNO' },
      { status: 500 }
    );
  }
});

// PATCH (toggle on/off): { macno, isActive }
export const PATCH = guard("account.manage", async (request) => {
  try {
    const { allowed } = await getAccountVisibilitySession();
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { macno, isActive } = await request.json();

    if (!macno || typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'macno and isActive (boolean) are required' },
        { status: 400 }
      );
    }

    const updatedMacno = await prisma.mACNO.update({
      where: { macno: Number(macno) },
      data: { isActive },
    });

    return NextResponse.json({ data: updatedMacno, status: 200 });
  } catch (error) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'MACNO not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Failed to update MACNO visibility' },
      { status: 500 }
    );
  }
});
