// /api/hr/devices — attendance machines.
//   GET   every machine with its last sync
//   POST  { name, ip, port, location, auto_sync, is_active } → add one
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { deviceData } from "@/lib/hr/devices";

// Machines & punches tab only — for those who run the machines, not every HR viewer.
export const GET = hrRoute([HR_PERMS.import, HR_PERMS.devices], async () => {
  const devices = await prisma.hrDevice.findMany({
    orderBy: [{ is_active: "desc" }, { name: "asc" }],
    include: { _count: { select: { punches: true } } },
  });
  return NextResponse.json({ devices: devices.map(({ _count, ...d }) => ({ ...d, punches: _count.punches })) });
});

export const POST = hrRoute([HR_PERMS.devices], async (req, { session }) => {
  const data = deviceData(await jsonBody(req));
  const device = await prisma.hrDevice.create({ data: { ...data, created_by: session.user.id } });
  return NextResponse.json({ device, message: `Machine "${device.name}" added.` }, { status: 201 });
});
