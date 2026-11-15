// GET /api/service-invoice/links?type=GRN|DISPATCH&search=&limit=30
//   GRNs (tran_code 4) or dispatches (tran_code 6) a Service Invoice line can
//   be linked to — newest first, searchable by number, party or document no.
//   → { data: [{ value, label, source_type, dated, party }] }
//
// GET /api/service-invoice/links?tran_id=123
//   A saved Service Invoice's linked documents, for the edit form
//   (lib/service/serviceInvoice.js loadServiceLinks).
//   → { links: [{ source_tran_id, source_type, label }] }
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { loadServiceLinks } from "@/lib/service/serviceInvoice";
import { documentScopeWhere } from "@/lib/auth/documentScope";

const TYPES = {
  GRN: { tran_code: 4, field: "grn_no" },
  DISPATCH: { tran_code: 6, field: "dispatch_no" },
  SALE_RETURN: { tran_code: 10, field: null }, // no number of its own: document no (rmk5)
};

// Same right as opening the Service Invoice list (voucher route GET).
const PERMISSION = "serviceInvoice.view";

export async function GET(req) {
  let session;
  try {
    ({ session } = await authorize(PERMISSION));
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }

  try {
    const { searchParams } = new URL(req.url);
    const tranId = Number(searchParams.get("tran_id"));
    if (tranId) return NextResponse.json({ links: await loadServiceLinks(tranId) });

    const type = TYPES[String(searchParams.get("type") || "").toUpperCase()];
    if (!type) return NextResponse.json({ error: "type must be GRN, DISPATCH or SALE_RETURN" }, { status: 400 });
    const sourceType = String(searchParams.get("type")).toUpperCase();
    const search = (searchParams.get("search") || "").trim();
    const limit = Math.min(Number(searchParams.get("limit")) || 30, 100);
    const n = Number(search);
    // Data scope: only GRNs / dispatches of the user's own godowns.
    const scopeFrags = await documentScopeWhere(session, type.tran_code);

    const rows = await prisma.transactionsMaster.findMany({
      where: {
        tran_code: type.tran_code,
        ...(scopeFrags.length && { AND: scopeFrags }),
        ...(search && {
          OR: [
            ...(Number.isInteger(n) ? [...(type.field ? [{ [type.field]: n }] : []), { tran_id: n }] : []),
            { rmk5: { contains: search } },
            { acno: { acname: { contains: search, mode: "insensitive" } } },
          ],
        }),
      },
      orderBy: [{ dated: "desc" }, { tran_id: "desc" }],
      take: limit,
      select: {
        tran_id: true, dated: true, rmk5: true, grn_no: true, dispatch_no: true,
        acno: { select: { acname: true } },
      },
    });

    return NextResponse.json({
      data: rows.map((r) => {
        const no = (type.field ? r[type.field] : null) ?? r.rmk5 ?? r.tran_id;
        const dated = r.dated ? new Date(r.dated).toLocaleDateString("en-GB") : "";
        return {
          value: r.tran_id,
          label: `${sourceType} ${no} · ${dated}${r.acno?.acname ? ` · ${r.acno.acname}` : ""}`,
          source_type: sourceType,
          dated: r.dated,
          party: r.acno?.acname ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("GET /api/service-invoice/links:", error);
    return NextResponse.json({ error: "Failed to load documents" }, { status: 500 });
  }
}
