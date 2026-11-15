// /api/orders/so-nature?so_nos=10826,10825 — is each planned Sale Order item
// ready to dispatch (lib/production/planNature.js soNatureStatus):
//   FINISHED                → ready
//   PROCESS / MANUFACTURING → ready once a Process Order for that SO + item is Posted
//   not marked yet          → "Awaiting Lab" (plan lines made after the Lab started marking)
// A Sale Order with no plan line is not in the result. Read only. The dispatch
// form uses it to show the line's Nature and to warn early; the voucher route
// enforces dispatch.requirePostedProcessOrder on its own.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { soNatureStatus } from "@/lib/production/planNature";

export const GET = guard(null, async (req) => {
  const soNos = (new URL(req.url).searchParams.get("so_nos") || "")
    .split(",")
    .map((v) => parseInt(v, 10))
    .filter(Number.isFinite)
    .slice(0, 200);
  if (!soNos.length) return NextResponse.json({ data: {} });
  try {
    return NextResponse.json({ data: await soNatureStatus(soNos) });
  } catch (error) {
    console.error("so-nature error:", error);
    return NextResponse.json({ error: "Failed to load nature" }, { status: 500 });
  }
});
