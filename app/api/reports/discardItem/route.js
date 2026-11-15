import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";

export async function PUT(request, { params }) {
    try {
        const url = new URL(request.url);
        const id = url.searchParams.get("id") || "";
        console.log(id)
        const item = await prisma.item.findUnique({
            where: { itcd: parseInt(id) },
        });

        if (!item) {
            return NextResponse.json({ error: 'Item not found' }, { status: 404 });
        }

        // Set alternate_id to null to free up the master sample number
        const updatedItem = await prisma.item.update({
            where: { itcd: parseInt(id) },
            data: {
                // alternate_id: null,
                discard:true
            },
        });

        return NextResponse.json(updatedItem);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to discard item', details: error.message }, { status: 500 });
    }
}
