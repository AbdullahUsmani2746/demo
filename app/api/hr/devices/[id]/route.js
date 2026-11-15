// /api/hr/devices/[id]
//   PUT     edit the machine
//   DELETE  remove it (its punches stay — they are attendance evidence)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { deviceData } from "@/lib/hr/devices";

export const PUT = hrRoute([HR_PERMS.devices], async (req, { params }) => {
  const id = intParam((await params).id);
  const data = deviceData(await jsonBody(req));
  const device = await prisma.hrDevice.update({ where: { id }, data });
  return NextResponse.json({ device, message: `Machine "${device.name}" saved.` });
});

export const DELETE = hrRoute([HR_PERMS.devices], async (req, { params }) => {
  const id = intParam((await params).id);
  const device = await prisma.hrDevice.delete({ where: { id } });
  return NextResponse.json({ success: true, message: `Machine "${device.name}" removed; its punches are kept.` });
});
