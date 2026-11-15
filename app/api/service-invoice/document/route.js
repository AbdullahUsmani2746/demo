// GET /api/service-invoice/document?type=GRN|DISPATCH[&tran_id=123]
//   What a GRN / dispatch form's Services panel needs
//   (lib/service/documentServices.js):
//   → {
//       visible,                       false → the panel is not shown
//       can: { create, update, delete } the Service Invoice rights
//       rows,                          editable rows of the saved document
//       readOnly,                      its other invoices (paid / shared)
//       services: [{ value, label, last: { pycd, vendor, rate, st_rate } | null }]
//       defaultRow,                    new document only: the service + vendor
//                                      it starts with (defaultServiceRow) | null
//     }
//   The panel is saved with the document (body.services), not here.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import {
  DOCUMENT_SERVICE_SOURCES,
  loadDocumentInvoices,
  invoicesToRows,
  lastServiceDefaults,
  defaultServiceRow,
} from "@/lib/service/documentServices";

const SOURCE_TYPES = new Set(Object.values(DOCUMENT_SERVICE_SOURCES).map((s) => s.source_type));

export async function GET(req) {
  let session;
  try {
    ({ session } = await authorize());
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }

  try {
    const { searchParams } = new URL(req.url);
    const type = String(searchParams.get("type") || "").toUpperCase();
    if (!SOURCE_TYPES.has(type)) {
      return NextResponse.json({ error: "type must be GRN or DISPATCH" }, { status: 400 });
    }
    const tranId = Number(searchParams.get("tran_id")) || null;

    const [view, create, update, del] = await Promise.all(
      ["serviceInvoice.view", "serviceInvoice.create", "serviceInvoice.update", "serviceInvoice.delete"].map((c) =>
        can(session, c),
      ),
    );
    if (!view) return NextResponse.json({ visible: false });

    const [{ owned, readOnly }, services, last, defaultRow] = await Promise.all([
      tranId ? loadDocumentInvoices(tranId) : { owned: [], readOnly: [] },
      prisma.service.findMany({
        where: { is_active: true },
        orderBy: { service_name: "asc" },
        select: { id: true, service_name: true },
      }),
      lastServiceDefaults(type),
      !tranId && create && type === "DISPATCH" ? defaultServiceRow(type) : null,
    ]);
    const rows = invoicesToRows(owned);

    return NextResponse.json({
      // Nothing to show and nothing they may add → no panel.
      visible: create || rows.length > 0 || readOnly.length > 0,
      can: { create, update, delete: del },
      rows,
      readOnly,
      services: services.map((s) => ({
        value: s.id,
        label: s.service_name || `Service ${s.id}`,
        last: last.get(s.id) ?? null,
      })),
      defaultRow,
    });
  } catch (error) {
    console.error("GET /api/service-invoice/document:", error);
    return NextResponse.json({ error: "Failed to load services" }, { status: 500 });
  }
}
