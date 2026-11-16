// app/api/pos/bootstrap/route.js — everything the till needs to start, in one call:
// settings (Settings → Point of Sale), features (group "pos"), the person's
// rights, their open shift, the categories sold, the company for the receipt,
// the stock check mode for POS and which POS accounts are still unset.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";
import { getAccount } from "@/lib/accounts/accountSettings";
import { getStockPolicy, modeOf } from "@/lib/stock/policy";
import { getPosSettings } from "@/lib/pos/settings";
import { posRights, openShiftOf } from "@/lib/pos/posting";
import { posErrorResponse, hasPosAccess } from "@/lib/pos/http";

export const GET = guard(null, async (request, { session }) => {
  try {
    const rights = await posRights(session);
    if (!hasPosAccess(rights)) return NextResponse.json({ error: "No point of sale access." }, { status: 403 });
    const settings = await getPosSettings();
    const [creditSales, requireShift, policy, shift, godown, company, cash, card, sales, tax, round] = await Promise.all([
      feature("pos.creditSales"),
      feature("pos.requireShift"),
      getStockPolicy(),
      openShiftOf(session.user.id),
      prisma.godown.findUnique({ where: { id: settings.godown }, select: { id: true, godown: true, is_active: true } }),
      prisma.company.findFirst({ orderBy: { id: "asc" }, select: { company: true, addr1: true, addr2: true, city: true, phone: true, email: true, logo: true } }),
      getAccount("pos_cash"),
      getAccount("pos_card"),
      getAccount("pos_sales"),
      getAccount("pos_tax"),
      getAccount("pos_round_off"),
    ]);
    const cats = await prisma.itemCategory.findMany({
      where: settings.categoryIds.length ? { id: { in: settings.categoryIds } } : {},
      select: { id: true, ic_name: true, _count: { select: { items: { where: { OR: [{ discard: false }, { discard: null }] } } } } },
      orderBy: { ic_name: "asc" },
    });
    const walkIn = settings.walkInAccount
      ? await prisma.aCNO.findUnique({ where: { acno: settings.walkInAccount }, select: { acno: true, acname: true } })
      : null;

    // What would stop a sale before the cashier tries.
    const problems = [];
    if (!godown || !godown.is_active) problems.push(`The POS godown (${settings.godown}) is unknown or closed — Settings → Point of Sale.`);
    if (cash == null && card == null) problems.push("Set the POS Cash / POS Card accounts — Account Settings → POS.");
    if (Number(settings.taxPercent) > 0 && tax == null) problems.push("Tax is on but POS Sales Tax Payable is not set — Account Settings → POS.");
    if (Number(settings.roundTo) > 0 && round == null) problems.push("Rounding is on but POS Round Off is not set — Account Settings → POS.");

    return NextResponse.json({
      settings,
      features: { creditSales, requireShift },
      rights,
      user: { id: session.user.id, name: session.user.name || session.user.email },
      shift,
      godown,
      company,
      walkIn,
      stockMode: modeOf(policy, "pos"),
      accounts: { cash: cash != null, card: card != null, sales: sales != null, tax: tax != null, round: round != null },
      categories: cats.filter((c) => c._count.items > 0).map((c) => ({ id: c.id, name: c.ic_name, count: c._count.items })),
      problems,
    });
  } catch (error) {
    return posErrorResponse(error, "POS bootstrap");
  }
});
