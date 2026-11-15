// /api/notifications/alerts/[id] — change or remove one alert, notification.manage.
//   PUT     the full alert (as POST /api/notifications/alerts), or { is_active } alone
//   DELETE
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { AlertError, alertData } from "@/lib/notifications/alertData";
import { invalidateAlerts } from "@/lib/notifications/alerts";

const idOf = async (params) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) throw new AlertError("Invalid alert.");
  return id;
};

export const PUT = guard("notification.manage", async (req, { params }) => {
  try {
    const id = await idOf(params);
    const b = await req.json();
    const onlyToggle = Object.keys(b).length === 1 && "is_active" in b;
    const alert = await prisma.notificationAlert.update({ where: { id }, data: onlyToggle ? { is_active: Boolean(b.is_active) } : alertData(b) });
    invalidateAlerts();
    return NextResponse.json({ success: true, alert, message: onlyToggle ? (alert.is_active ? "Alert switched on." : "Alert switched off.") : "Alert saved." });
  } catch (e) {
    if (e instanceof AlertError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e?.code === "P2025") return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    throw e;
  }
});

export const DELETE = guard("notification.manage", async (req, { params }) => {
  try {
    const id = await idOf(params);
    await prisma.notificationAlert.delete({ where: { id } });
    invalidateAlerts();
    return NextResponse.json({ success: true, message: "Alert deleted." });
  } catch (e) {
    if (e instanceof AlertError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e?.code === "P2025") return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    throw e;
  }
});
