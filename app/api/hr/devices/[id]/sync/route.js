// /api/hr/devices/[id]/sync
//   POST {}             pull new punches now and rebuild those days
//   POST { test: true } only connect and read the machine's counters
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam } from "@/lib/hr/route";
import { syncOne, testDevice } from "@/lib/hr/devices";

export const maxDuration = 120;

export const POST = hrRoute([HR_PERMS.import, HR_PERMS.devices], async (req, { params, session }) => {
  const id = intParam((await params).id);
  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const device = await prisma.hrDevice.findUnique({ where: { id } });
  if (!device) return NextResponse.json({ error: "Machine not found." }, { status: 404 });

  if (body.test) {
    const r = await testDevice(device);
    return r.ok
      ? NextResponse.json({ ...r, message: `Connected — ${r.users ?? "?"} user(s), ${r.logs ?? "?"} punch(es) on the machine.` })
      : NextResponse.json({ error: r.error }, { status: 502 });
  }
  if (!device.is_active) return NextResponse.json({ error: "This machine is switched off in the system — activate it first." }, { status: 400 });
  const r = await syncOne(device, { actor: session.user.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({
    ...r,
    message:
      `${r.inserted} new punch(es) · ${r.days} day(s) updated` +
      (r.unmapped ? ` · ${r.unmapped} machine id(s) not matched to an employee` : "") +
      (r.skippedManual ? ` · ${r.skippedManual} day(s) kept as corrected by hand` : ""),
  });
});
