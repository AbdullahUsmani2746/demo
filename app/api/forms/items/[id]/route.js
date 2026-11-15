import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { recordScopeError } from "@/lib/auth/documentScope";

export async function GET(request, { params }) {
    try {
        const item = await prisma.item.findUnique({
            where: {
                itcd: parseInt(params.id)
            },
            include: {
                itemCategories: true,
                subtrateRef: true,
            },
        });


        if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
        return NextResponse.json(item);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch item', details: error.message }, { status: 500 });
    }
}

// Data scope (Admin → Permissions → Item categories): an item outside the
// person's categories can't be changed, nor moved into / out of them.
async function itemScopeError(session, ...categoryIds) {
    for (const ic of categoryIds) {
        const err = await recordScopeError(session, "itemCategory", [ic]);
        if (err) return err;
    }
    return null;
}

export const PUT = guard("setup.items.manage", async (request, { session }) => {
    try {
        const data = await request.json();

        const stored = await prisma.item.findUnique({ where: { itcd: parseInt(data.itcd) }, select: { ic_id: true } });
        if (!stored) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
        const scopeError = await itemScopeError(session, stored.ic_id, data.ic_id ?? stored.ic_id);
        if (scopeError) {
            return NextResponse.json({ error: `${scopeError} This item's category is not one of them.` }, { status: 403 });
        }

        const inkCode = data.code?.trim();
        if (inkCode) {
            const existingCode = await prisma.item.findFirst({
                where: {
                    code: { equals: inkCode, mode: 'insensitive' },
                    itcd: { not: parseInt(data.itcd) },
                },
            });

            if (existingCode) {
                return NextResponse.json(
                    { error: `Ink code "${inkCode}" is already used by "${existingCode.item}" (itcd ${existingCode.itcd}).` },
                    { status: 409 }
                );
            }
        }

        //insert lamination into SRLamination table if it doesn't exist
        if (data.lamination) {
            await prisma.sRLamination.upsert({
                where: { sr_lamination: data.lamination },
                update: {},
                create: { sr_lamination: data.lamination },
            });
        }

        // Remove primary key from update data
        const { itcd, itemCategories, subtrateRef, ...updateData } = data;
        const item = await prisma.item.update({
            where: { itcd: parseInt(itcd) },
            data: {
                ...updateData,
                ...(inkCode ? { code: inkCode } : {}),
            },
        });
        return NextResponse.json(item);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update item', details: error.message }, { status: 500 });
    }
});

export const DELETE = guard("setup.items.manage", async (request, { params, session }) => {
    try {
        const stored = await prisma.item.findUnique({ where: { itcd: parseInt(params.id) }, select: { ic_id: true } });
        if (!stored) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
        const scopeError = await itemScopeError(session, stored.ic_id);
        if (scopeError) {
            return NextResponse.json({ error: `${scopeError} This item's category is not one of them.` }, { status: 403 });
        }
        await prisma.item.delete({ where: { itcd: parseInt(params.id) } });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete item', details: error.message }, { status: 500 });
    }
});