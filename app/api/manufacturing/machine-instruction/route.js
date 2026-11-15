import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { guard } from "@/lib/auth/route";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  let sortBy = searchParams.get('sortBy') || 'rec_id';
  const sortOrder = searchParams.get('sortOrder') || 'asc';

  if (sortBy === 'id') {
    sortBy = 'rec_id';
  }

  try {
    const where = {};

    if (search) {
      const searchNum = parseInt(search);
      const conditions = [];

      // 🔹 machine_id NUMBER hai
      if (!isNaN(searchNum)) {
        conditions.push({ machine_id: searchNum });
        conditions.push({ rec_id: searchNum });
      }

      // 🔹 Related item name search (STRING field)
      conditions.push({
        item: {
          item: { contains: search, mode: 'insensitive' }
        }
      });

      where.OR = conditions;
    }

    if (status) {
      where.status = status;
    }

    const orderBy = { [sortBy]: sortOrder };

    const total = await prisma.mACHINE_INSTRUCTION_MASTER.count({ where });

    const machines = await prisma.mACHINE_INSTRUCTION_MASTER.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        machineDetails: {
          include: { item: true },
        },
        item: true,
      },
    });

    return NextResponse.json({ data: machines, total }, { status: 200 });

  } catch (error) {
    console.error("Machine GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const POST = guard("machineInstruction.manage", async (request) => {
  try {
    const data = await request.json();
    const { machine_id, time_min, descr, machineDetails } = data;

    
    const master = await prisma.mACHINE_INSTRUCTION_MASTER.create({
      data: {
        machine_id: parseInt(machine_id),
        time_min: time_min,
        descr,
      },
    });
    for (const det of machineDetails) {
      await prisma.mACHINE_INSTRUCTION_DETAIL.create({
        data: {
          rec_id: master.rec_id,
          machine_id: parseInt(det.machine_id),
          part: det.part,
          time_min: det.time_min,
          instructions: det.instructions,
        },
      });
    }
    const newMachine = await prisma.mACHINE_INSTRUCTION_MASTER.findUnique({
      where: { rec_id: master.rec_id },
      include: {
        machineDetails: {
          include: { item: true },
        },
        item: true,
      },
    });
    const formattedNew = {
      id: newMachine.rec_id,
      machineId: newMachine.machine_id,
      productName: newMachine.item.item,
      timeMin: newMachine.time_min,
      descr: newMachine.descr,
      details: newMachine.machineDetails.map(detail => ({
        id: detail.id,
        machineId: detail.machine_id,
        part: detail.part,
        timeMin: detail.time_min,
        instructions: detail.instructions,
        name: detail.item.item,
      })),
    };
    return Response.json(formattedNew, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});