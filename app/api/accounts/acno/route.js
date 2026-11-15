import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getAccountVisibilitySession } from '@/lib/accounts/visibility';
import { guard } from "@/lib/auth/route";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { customerScopeWhere } from "@/lib/auth/salesScope";
import { getAccountGroup, getAccountGroups, getAccountList } from "@/lib/accounts/accountSettings";
import { pickerScopeWhere } from "@/lib/auth/documentScope";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const macnoParam = searchParams.get('macno') || "";
    const acno = searchParams.get('acno') || "";
    const acnoParam = searchParams.get('acnos') || "";
    const excludeMacnoParam = searchParams.get('excludeMacno') || "";
    const excludeAcnoParam = searchParams.get('excludeAcno') || "";
    const search = searchParams.get('search') || "";
    const includeInactiveParam = searchParams.get('includeInactive') === 'true';

    const { allowed } = await getAccountVisibilitySession();
    const includeInactive = includeInactiveParam && allowed;

    // Resolving a specific already-known acno/acnos (e.g. to show the label of
    // an account already saved on an existing transaction) must succeed even
    // if that account has since been switched off — only fresh browsing/search
    // hides off accounts. The frontend badges the result as "Off" instead.
    const isExactLookup = !!acno || !!acnoParam;

    const where = {};

    // if (!includeInactive && !isExactLookup) {
    //   where.isActive = true;
    //   where.mainAccount = { isActive: true };
    // }

    // Case 1 or 2: macno and / or a named group from Finance → Account
    // Settings (?group=customers,vendors). Groups are resolved here so no
    // screen ever carries a macno number.
    // An exact lookup (?acno= / ?acnos=) resolves the label of an account
    // already saved on a document, so it is never narrowed by a group — the
    // account may sit outside the group today.
    const groupKeys = (searchParams.get('group') || '').split(',').map(g => g.trim()).filter(Boolean);
    if (!isExactLookup && (macnoParam || groupKeys.length)) {
      const macnos = [
        ...macnoParam.split(',').map(m => parseInt(m.trim(), 10)).filter(m => !Number.isNaN(m)),
        ...(groupKeys.length ? await getAccountGroups(groupKeys) : []),
      ];
      // A group nobody has configured must list nothing, not everything.
      where.macno = { in: [...new Set(macnos)] };
    }

    if(acnoParam){
      const acnoList = acnoParam.split(',').map(a => parseInt(a.trim(),10));
      where.acno = { in: acnoList };
    }

    if(acno){
      where.acno = parseInt(acno);
    }

    // Case 3: Exclude by macno (e.g., get all acnos except where macno is 003 or 004)
    const excludeGroupKeys = (searchParams.get('excludeGroup') || '').split(',').map(g => g.trim()).filter(Boolean);
    if (excludeMacnoParam || excludeGroupKeys.length) {
      const excludeMacnos = [
        ...excludeMacnoParam.split(',').map(m => parseInt(m.trim(), 10)).filter(m => !Number.isNaN(m)),
        ...(excludeGroupKeys.length ? await getAccountGroups(excludeGroupKeys) : []),
      ];
      where.macno = { ...(where.macno || {}), notIn: excludeMacnos };
    }

    // ?excludeList=blocked_voucher_accounts — accounts from a LIST setting
    // that a picker must not offer (e.g. control accounts on manual vouchers).
    const excludeListKeys = (searchParams.get('excludeList') || '').split(',').map(g => g.trim()).filter(Boolean);
    if (excludeListKeys.length && !isExactLookup) {
      const blocked = (await Promise.all(excludeListKeys.map(k => getAccountList(k).catch(() => [])))).flat();
      if (blocked.length) where.acno = { ...(where.acno && typeof where.acno === 'object' ? where.acno : {}), notIn: blocked };
    }

    // Case 4: Exclude specific accounts (e.g. a Payment line must not offer the
    // very account the voucher is paid from). An exact lookup is resolving a
    // label for an account already saved on the row, so it is never filtered.
    if (excludeAcnoParam && !isExactLookup) {
      const excludeAcnos = excludeAcnoParam
        .split(',')
        .map(a => parseInt(a.trim(), 10))
        .filter(a => !Number.isNaN(a));
      if (excludeAcnos.length) {
        where.acno = { notIn: [...(where.acno?.notIn || []), ...excludeAcnos] };
      }
    }

    if (search) {
      const numericSearch = parseInt(search);
      where.OR = [
        { acname: { contains: search, mode: "insensitive" } },
        ...(!isNaN(numericSearch) ? [{ acno: numericSearch }] : []),
      ];
    }
    // ?scope=sales — customer pickers on sales reports: a sales person is
    // offered only their own customers (lib/auth/salesScope.js).
    if (searchParams.get('scope') === 'sales') {
      Object.assign(where, await customerScopeWhere(await getServerSession(authOptions)));
    }
    // Data scope (Admin → Permissions): a person limited to some cash / bank
    // accounts or vendors is offered only those in that group's pickers.
    // An exact lookup still resolves the label of an account already saved.
    if (groupKeys.length && !isExactLookup) {
      const pickerWhere = await pickerScopeWhere(await getServerSession(authOptions), groupKeys, getAccountGroup);
      if (pickerWhere.length) where.AND = [...(where.AND || []), ...pickerWhere];
    }

    const acnos = await prisma.aCNO.findMany({
      where,
      include: { mainAccount: { select: { isActive: true } } },
    });

    return NextResponse.json({ data: acnos, status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to fetch ACNO data' },
      { status: 500 }
    );
  }
}

export const POST = guard("account.manage", async (request) => {
  try {
    const body = await request.json();
    const {
      macno,
      acno,
      acname,
      bankAccountNo,
      address,
      city,
      phoneFax,
      email,
      website,
      crDays,
      crDays2,
      areaCode,
      stRate,
      area,
      category,
      subCategory,
      country,
      customerBank,
      customerBankAddr,
      stRegNo,
      stReg,
      ntnNo,
      contactPerson,
      crLimit,
      salesArea,
      tax_filing_status,
      tax_law_code,
      lock,
      customerStatus,
      reconStatus,
      reconciliationRemarks,
    } = body;


    
    if (!macno || !acname) {
      return NextResponse.json(
        { error: 'macno, acno, and acname are required' },
        { status: 400 }
      );
    }

    // if(!acno ){}

    const parentExists = await prisma.mACNO.findUnique({
      where: { macno: Number(macno) },
    });

    
    if (!parentExists) {
      return NextResponse.json(
        { error: 'Parent MACNO does not exist' },
        { status: 400 }
      );
    }
    // Check if the combination of macno and acno already exists
    // const existingAcno = await prisma.aCNO.findFirst({
    //   where: {
    //     macno: Number(macno),
    //     acno: acno,
    //   },
    // });

    // if (existingAcno) {
    //   
    //   return NextResponse.json(
    //     { error: 'ACNO combination already exists' },
    //     { status: 400 }
    //   );
    // }

    

    
  
    const newAcno = await prisma.aCNO.create({
      data: {
        macno: Number(macno),
        acname,
        bankAccountNo,
        address,
        city,
        phoneFax,
        email,
        website,
        crDays: crDays ? Number(crDays) : null,
        crDays2: crDays2 ? Number(crDays2) : null,
        areaCode,
        stRate: stRate ? stRate : null,
        area,
        category,
        subCategory,
        country,
        customerBank,
        customerBankAddr,
        stRegNo,
        stReg,
        ntnNo,
        contactPerson,
        crLimit: crLimit ? Number(crLimit) : null,
        salesArea,
        tax_filing_status,
        tax_law_code: tax_law_code ? Number(tax_law_code) : null,
        lock: lock === true || lock === 'true' ? true : false,
        customerStatus,
        reconStatus,
        reconciliationRemarks,
      },
    //   include: {
    //     mainAccount: true,
    //   },
    });

    
    
    return NextResponse.json({data:newAcno, status: 201 });
  } catch (error) {
    if (error.code === 'P2002') {
      
      return NextResponse.json(
        { error: 'ACNO combination already exists' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to create ACNO' },
      { status: 500 }
    );
  }
});

// PUT (Update an ACNO)
export const PUT = guard("account.manage", async (request) => {
  try {
    const body = await request.json();
    const {
      macno,
      acno,
      acname,
      bankAccountNo,
      address,
      city,
      phoneFax,
      email,
      website,
      crDays,
      crDays2,
      areaCode,
      stRate,
      area,
      category,
      subCategory,
      country,
      customerBank,
      customerBankAddr,
      stRegNo,
      stReg,
      ntnNo,
      contactPerson,
      crLimit,
      salesArea,
      tax_filing_status,
      tax_law_code,
       lock,
      customerStatus,
      reconStatus,
      reconciliationRemarks,
    } = body;

    if (!acno || !acname) {
      return NextResponse.json(
        { error: 'acno and acname are required' },
        { status: 400 }
      );
    }

    // Ensure parent MACNO exists
    if (macno) {
      const parentExists = await prisma.mACNO.findUnique({ where: { macno: Number(macno) } });
      if (!parentExists) {
        return NextResponse.json(
          { error: 'Parent MACNO does not exist' },
          { status: 400 }
        );
      }
    }

    const updatedAcno = await prisma.aCNO.update({
      where: {
        acno: Number(acno),
      },
      data: {
        ...(macno ? { macno: Number(macno) } : {}),
        acname,
        bankAccountNo,
        address,
        city,
        phoneFax,
        email,
        website,
        crDays: crDays ? Number(crDays) : null,
        crDays2: crDays2 ? Number(crDays2) : null,
        areaCode,
        stRate: stRate ? stRate : null,
        area,
        category,
        subCategory,
        country,
        customerBank,
        customerBankAddr,
        stRegNo,
        stReg,
        ntnNo,
        contactPerson,
        crLimit: crLimit ? Number(crLimit) : null,
        salesArea,
        tax_filing_status,
        tax_law_code: tax_law_code ? Number(tax_law_code) : null,
        lock: lock === true || lock === 'true' ? true : false,
        customerStatus,
        reconStatus,
        reconciliationRemarks,
      },
    });

    return NextResponse.json({ data: updatedAcno, status: 200 });
  } catch (error) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'ACNO not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Failed to update ACNO' },
      { status: 500 }
    );
  }
});

// DELETE (?macno=XX&acno=YY)
export const DELETE = guard("account.manage", async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const acno = searchParams.get('code') || "";

    if (!acno) {
      return NextResponse.json(
        { error: 'acno query parameters are required' },
        { status: 400 }
      );
    }

    await prisma.aCNO.delete({
      where: {
        acno: Number(acno),
      },
    });

    return NextResponse.json({
      message: 'ACNO deleted successfully',
      status: 200,
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'ACNO not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Failed to delete ACNO' },
      { status: 500 }
    );
  }
});

// PATCH (toggle on/off): { acno, isActive }
export const PATCH = guard("account.manage", async (request) => {
  try {
    const { allowed } = await getAccountVisibilitySession();
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { acno, isActive } = await request.json();

    if (!acno || typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'acno and isActive (boolean) are required' },
        { status: 400 }
      );
    }

    const updatedAcno = await prisma.aCNO.update({
      where: { acno: Number(acno) },
      data: { isActive },
    });

    return NextResponse.json({ data: updatedAcno, status: 200 });
  } catch (error) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'ACNO not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Failed to update ACNO visibility' },
      { status: 500 }
    );
  }
});