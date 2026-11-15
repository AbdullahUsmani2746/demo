// app/api/contacts/route.js (similar structure)
import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const acno = parseInt(searchParams.get('acno') || '0');
  const search = searchParams.get('search') || '';

  const where = {
    acno,
    OR: search ? [
      { name: { contains: search, mode: 'insensitive' } },
      { designation: { contains: search, mode: 'insensitive' } },
      { id: { equals: parseInt(search) || undefined } },
    ] : undefined,
  };

  const contacts = await prisma.pARTY_MANAGEMENT.findMany({ where });
  return NextResponse.json(contacts);
}

export const POST = guard("customer.update", async (request) => {
  const data = await request.json();
  const contact = await prisma.pARTY_MANAGEMENT.create({ data });
  return NextResponse.json(contact);
});

export const PUT = guard("customer.update", async (request) => {
  const { id, ...data } = await request.json();
  const contact = await prisma.pARTY_MANAGEMENT.update({
    where: { id: parseInt(id) },
    data,
  });
  return NextResponse.json(contact);
});

export const DELETE = guard("customer.update", async (request) => {
  const { id } = await request.json();
  await prisma.pARTY_MANAGEMENT.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ success: true });
});