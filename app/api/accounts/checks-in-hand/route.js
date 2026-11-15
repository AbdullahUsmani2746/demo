import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  CHECK_STATUS,
  CHECK_STATUSES,
  categoryWhere,
  normalizeBank,
  normalizeText,
  normalizeStatus,
  startOfDay,
  endOfDay,
  serializeCheck,
  toNumber,
} from "@/lib/accounts/checksInHand";
import { guard } from "@/lib/auth/route";

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/accounts/checks-in-hand
//  List cheques for the entry screen.
//
//  Query params (all optional):
//    dateFrom, dateTo  - date range filter
//    dateField         - which date the range applies to: chqDate (default) |
//                        chqRcvDate | dated | depDate
//    acno              - single customer
//    status            - PENDING | CLEARED  (omit / "all" for both)
//    category          - active | inactive  (dual book, omit for both)
//    search            - matches cheque no, bank, customer name, brought-by
//    page, limit       - pagination (limit=0 returns everything)
// ─────────────────────────────────────────────────────────────────────────────
const DATE_FIELDS = new Set(["chqDate", "chqRcvDate", "dated", "depDate"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const rawDateField = searchParams.get("dateField") || "chqDate";
    const dateField = DATE_FIELDS.has(rawDateField) ? rawDateField : "chqDate";
    const acno = searchParams.get("acno");
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const search = (searchParams.get("search") || "").trim();
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limitParam = searchParams.get("limit");
    const limit = limitParam === "0" ? 0 : Math.max(1, Number(limitParam) || 50);

    // baseWhere deliberately excludes the status filter: the summary tiles
    // always show the full Pending / Cleared split for the current date,
    // customer, book and search selection, so switching the Status filter
    // narrows the list without making the tiles disagree with each other.
    const baseWhere = {};

    if (dateFrom || dateTo) {
      baseWhere[dateField] = {
        ...(dateFrom ? { gte: startOfDay(dateFrom) } : {}),
        ...(dateTo ? { lte: endOfDay(dateTo) } : {}),
      };
    }

    if (acno && acno !== "all") baseWhere.acno = Number(acno);

    // Deposit/transfer bank — which of our bank ledgers the cheque went into.
    const depAcno = searchParams.get("depAcno");
    if (depAcno && depAcno !== "all") baseWhere.depAcno = Number(depAcno);

    // Dual book spans two levels (ACNO.is_active + parent MACNO.is_active),
    // so this is not a single is_active comparison - see categoryWhere().
    const catWhere = categoryWhere(category);
    if (catWhere) baseWhere.customer = catWhere;

    // Sales person — the user the cheque's customer is assigned to
    // (ACNO.sales_ares). That column holds a user id or, on older rows, a
    // username, so both are matched.
    const salesPerson = searchParams.get("salesPerson");
    if (salesPerson && salesPerson !== "all") {
      const sp = await prisma.user.findFirst({
        where: { OR: [{ id: salesPerson }, { username: salesPerson }] },
        select: { id: true, username: true },
      });
      const keys = [salesPerson, sp?.id, sp?.username].filter(Boolean);
      baseWhere.customer = {
        ...(baseWhere.customer || {}),
        salesArea: { in: [...new Set(keys)] },
      };
    }

    if (search) {
      baseWhere.OR = [
        { chqNo: { contains: search, mode: "insensitive" } },
        { bank: { contains: search, mode: "insensitive" } },
        { chqBrBy: { contains: search, mode: "insensitive" } },
        { rmk: { contains: search, mode: "insensitive" } },
        { customer: { acname: { contains: search, mode: "insensitive" } } },
        { depositBank: { acname: { contains: search, mode: "insensitive" } } },
      ];
    }

    const where = { ...baseWhere };
    if (status && status !== "all") {
      const s = normalizeBank(status);
      if (CHECK_STATUSES.includes(s)) where.status = s;
    }

    const [rows, total, pendingAgg, clearedAgg] = await Promise.all([
      prisma.checksInHand.findMany({
        where,
        include: {
          customer: { select: { acname: true, isActive: true, salesArea: true, mainAccount: { select: { isActive: true } } } },
          depositBank: { select: { acno: true, acname: true } },
        },
        orderBy: [{ chqDate: "desc" }, { id: "desc" }],
        ...(limit ? { skip: (page - 1) * limit, take: limit } : {}),
      }),
      prisma.checksInHand.count({ where }),
      prisma.checksInHand.aggregate({
        where: { ...baseWhere, status: CHECK_STATUS.PENDING },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.checksInHand.aggregate({
        where: { ...baseWhere, status: CHECK_STATUS.CLEARED },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const pendingAmount = toNumber(pendingAgg._sum.amount);
    const clearedAmount = toNumber(clearedAgg._sum.amount);
    const pendingCount = Number(pendingAgg._count._all || 0);
    const clearedCount = Number(clearedAgg._count._all || 0);

    // Sales person name for each row's customer (sales_ares = user id or
    // username). One lookup for the page; serializeCheck is left unchanged
    // since the create / update responses share it.
    const spKeys = [...new Set(rows.map((r) => r.customer?.salesArea).filter(Boolean))];
    const spUsers = spKeys.length
      ? await prisma.user.findMany({
          where: { OR: [{ id: { in: spKeys } }, { username: { in: spKeys } }] },
          select: { id: true, username: true, name: true },
        })
      : [];
    const spName = new Map();
    spUsers.forEach((u) => {
      const label = u.name || u.username || u.id;
      spName.set(u.id, label);
      if (u.username) spName.set(u.username, label);
    });

    return NextResponse.json({
      data: rows.map((r) => ({
        ...serializeCheck(r),
        salesPersonName: (r.customer?.salesArea && spName.get(r.customer.salesArea)) || null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: limit ? Math.ceil(total / limit) : 1,
      },
      summary: {
        totalCount: pendingCount + clearedCount,
        totalAmount: pendingAmount + clearedAmount,
        pendingCount,
        pendingAmount,
        clearedCount,
        clearedAmount,
      },
    });
  } catch (error) {
    console.error("Error fetching checks in hand:", error);
    return NextResponse.json(
      { error: "Failed to fetch checks in hand" },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/accounts/checks-in-hand
//  Body: a single cheque object, or { rows: [...] } for the multi-row entry
//  grid. New cheques normally start PENDING with no deposit date - clearing is
//  a separate, deliberate status change (PATCH on [id]).
// ─────────────────────────────────────────────────────────────────────────────
// session.user.id is the JWT's `sub`, which is only ever as fresh as the
// cookie. A token minted against an earlier/different User table still
// validates against NEXTAUTH_SECRET and carries an id no User row has - seen
// live here, where the session held a cuid while this database's users are
// '1' and '1000001'. user_id is audit metadata, so verify it resolves and drop
// it when it does not, rather than letting a stale cookie trip the FK and stop
// a cheque from being recorded at all.
async function resolveUserId(session) {
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id: String(id) },
    select: { id: true },
  });
  return user?.id ?? null;
}

export const POST = guard("account.manage", async (request) => {
  try {
    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session);

    const body = await request.json();
    const rows = Array.isArray(body?.rows) ? body.rows : [body];

    if (!rows.length) {
      return NextResponse.json({ error: "No cheque rows supplied" }, { status: 400 });
    }

    const prepared = [];
    for (let i = 0; i < rows.length; i++) {
      const built = buildCreateData(rows[i], userId);
      if (built.error) {
        return NextResponse.json(
          { error: "Row " + (i + 1) + ": " + built.error },
          { status: 400 }
        );
      }
      prepared.push(built.data);
    }

    // Reject duplicates of the same cheque (same customer + bank + cheque no)
    // before writing - a re-submitted form is the common way this happens.
    const clashes = await prisma.checksInHand.findMany({
      where: {
        OR: prepared.map((p) => ({ acno: p.acno, bank: p.bank, chqNo: p.chqNo })),
      },
      select: { chqNo: true, bank: true },
    });
    if (clashes.length) {
      return NextResponse.json(
        {
          error:
            "Cheque already recorded: " +
            clashes.map((c) => c.chqNo + " (" + c.bank + ")").join(", "),
        },
        { status: 409 }
      );
    }

    const created = await prisma.$transaction(
      prepared.map((data) =>
        prisma.checksInHand.create({
          data,
          include: {
            customer: { select: { acname: true, isActive: true, mainAccount: { select: { isActive: true } } } },
            depositBank: { select: { acno: true, acname: true } },
          },
        })
      )
    );

    return NextResponse.json(
      { data: created.map(serializeCheck), created: created.length },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating checks in hand:", error);
    return NextResponse.json({ error: "Failed to save cheque" }, { status: 500 });
  }
});

function buildCreateData(row, userId) {
  const acno = Number(row?.acno);
  if (!acno) return { error: "Customer is required" };

  const bank = normalizeBank(row?.bank);
  if (!bank) return { error: "Bank is required" };

  const chqNo = String(row?.chqNo ?? "").trim().toUpperCase();
  if (!chqNo) return { error: "Cheque no. is required" };

  if (!row?.chqDate) return { error: "Cheque date is required" };
  const chqDate = startOfDay(row.chqDate);
  if (Number.isNaN(chqDate.getTime())) return { error: "Cheque date is invalid" };

  const amount = Number(row?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be greater than zero" };
  }

  const status = normalizeStatus(row?.status);

  // Optional at entry time: a cheque can sit in hand before anyone decides
  // which of our banks it will be deposited into.
  const depAcno = row?.depAcno ? Number(row.depAcno) : null;
  if (row?.depAcno && !Number.isFinite(depAcno)) {
    return { error: "Transfer bank is invalid" };
  }

  return {
    data: {
      acno,
      depAcno,
      bank,
      chqNo,
      chqDate,
      amount,
      chqRcvDate: row?.chqRcvDate ? startOfDay(row.chqRcvDate) : null,
      dated: row?.dated ? startOfDay(row.dated) : new Date(),
      rmk: normalizeText(row?.rmk),
      chqBrBy: normalizeText(row?.chqBrBy),
      // A cheque may legitimately be entered as already cleared (back-entry of
      // history); everything else starts PENDING.
      status,
      depDate:
        status === CHECK_STATUS.CLEARED
          ? startOfDay(row?.depDate || new Date())
          : null,
      user_id: userId,
    },
  };
}
