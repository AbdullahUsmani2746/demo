// lib/service/documentServices.js
// ============================================================
// SERVICES ON A GRN / DISPATCH (the form's "Services" panel)
//
// The GRN (tran_code 4) and Dispatch (6) forms carry a Services panel:
// freight, off-loading, weighing … each row = service · vendor · vendor
// invoice no · qty · rate · ST %. The document's save sends them as
// `body.services`; this module turns them into ordinary Service Invoices
// (tran_code 21, lib/service/serviceInvoice.js — same pricing, same posting)
// linked to the document through service_invoice_links:
//
//   one invoice per vendor + vendor invoice no (blank no = its own group)
//   a new invoice takes the document's date / godown; a saved one keeps its own
//   a row that came from a saved invoice stays on that invoice
//   an invoice the panel no longer lists is deleted
//   an unchanged invoice is not rewritten (no audit noise)
//
// The panel owns only the invoices linked to THIS document alone and not yet
// knocked off by a payment; those linked to several documents, or already
// paid, are listed read-only — change them on the Service Invoice screen.
//
// Rights are the Service Invoice's own (serviceInvoice.create / .update /
// .delete) and its period lock (tran_code 21). Everything is validated by
// planDocumentServices BEFORE the document is written; syncDocumentServices
// writes inside the document's save transaction. `body.services` missing →
// the document's invoices are left as they are.
//
// A GRN / dispatch with service invoices cannot be deleted
// (documentServicesDeleteError) — remove them from its panel first.
// ============================================================
import prisma from "@/lib/prisma";
import { can } from "@/lib/auth/permissions";
import { checkPeriodLock } from "@/lib/periodLock";
import { clearVoucherAllocations } from "@/lib/ledger/invoiceMatcher";
import { prepareServiceInvoice, serviceInvoiceAutoEntries, syncServiceLinks } from "@/lib/service/serviceInvoice";

const SERVICE_TRAN_CODE = 21;
// Documents that carry the panel: tran_code → link source_type / header number.
export const DOCUMENT_SERVICE_SOURCES = {
  4: { source_type: "GRN", field: "grn_no", label: "GRN" },
  6: { source_type: "DISPATCH", field: "dispatch_no", label: "Dispatch" },
};

const intOf = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const num = (v) => parseFloat(v?.value ?? v) || 0;
const text = (v) => String(v?.value ?? v ?? "").trim();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dayKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/**
 * The service invoices linked to a document, split into the ones its panel
 * edits and the read-only rest.
 * @returns {{ owned: object[], readOnly: object[] }} owned — full invoices
 *   (master + sub_tran_id 1 lines); readOnly — { tran_id, vr_no, vendor, total, reason }
 */
export async function loadDocumentInvoices(sourceTranId, { db = prisma } = {}) {
  const id = intOf(sourceTranId);
  if (!id) return { owned: [], readOnly: [] };
  const links = await db.serviceInvoiceLink.findMany({ where: { source_tran_id: id }, select: { tran_id: true } });
  const invoiceIds = [...new Set(links.map((l) => l.tran_id))];
  if (!invoiceIds.length) return { owned: [], readOnly: [] };

  const [allLinks, invoices, paid] = await Promise.all([
    db.serviceInvoiceLink.findMany({
      where: { tran_id: { in: invoiceIds } },
      select: { tran_id: true, source_tran_id: true },
    }),
    db.transactionsMaster.findMany({
      where: { tran_id: { in: invoiceIds }, tran_code: SERVICE_TRAN_CODE },
      orderBy: [{ vr_no: "asc" }, { tran_id: "asc" }],
      select: {
        tran_id: true, vr_no: true, dated: true, pycd: true, invoice_no: true, godown: true, rmk: true,
        acno: { select: { acname: true } },
        transactions: {
          where: { sub_tran_id: 1 },
          orderBy: { id: "asc" },
          select: {
            service_id: true, qty: true, rate: true, st_rate: true, additional_tax: true,
            gross_amount: true, st_amount: true, narration1: true,
            official_amount: true, unofficial_amount: true,
            serviceDetails: { select: { service_name: true } },
          },
        },
      },
    }),
    db.invoiceKnockoff.findMany({
      where: { invoice_tran_id: { in: invoiceIds }, reversed_at: null },
      select: { invoice_tran_id: true },
      distinct: ["invoice_tran_id"],
    }),
  ]);

  const otherDocs = new Set(allLinks.filter((l) => l.source_tran_id !== id).map((l) => l.tran_id));
  const paidIds = new Set(paid.map((p) => p.invoice_tran_id));
  const owned = [];
  const readOnly = [];
  for (const inv of invoices) {
    // Official / Unofficial amounts are typed on the Service Invoice screen
    // only; the panel prices by rate and would drop them, so it leaves such an
    // invoice alone.
    const byParts = inv.transactions.some((t) => t.official_amount != null || t.unofficial_amount != null);
    if (!otherDocs.has(inv.tran_id) && !paidIds.has(inv.tran_id) && !byParts) {
      owned.push(inv);
      continue;
    }
    readOnly.push({
      tran_id: inv.tran_id,
      vr_no: inv.vr_no,
      vendor: inv.acno?.acname ?? (inv.pycd != null ? String(inv.pycd) : ""),
      invoice_no: inv.invoice_no ?? "",
      services: inv.transactions.map((t) => t.serviceDetails?.service_name).filter(Boolean).join(", "),
      total: round2(inv.transactions.reduce((s, t) => s + num(t.gross_amount) + num(t.st_amount), 0)),
      reason: paidIds.has(inv.tran_id)
        ? "Paid"
        : otherDocs.has(inv.tran_id)
          ? "Shared with other documents"
          : "Has official / unofficial amounts — edit on the Service Invoice screen",
    });
  }
  return { owned, readOnly };
}

/** Panel rows of the invoices the panel edits (the GET for the form). */
export function invoicesToRows(owned) {
  return owned.flatMap((inv) =>
    inv.transactions.map((t) => ({
      tran_id: inv.tran_id,
      vr_no: inv.vr_no,
      service_id: t.service_id,
      service_name: t.serviceDetails?.service_name ?? "",
      pycd: inv.pycd,
      vendor: inv.acno?.acname ?? "",
      invoice_no: inv.invoice_no ?? "",
      qty: t.qty ?? 1,
      rate: t.rate ?? 0,
      st_rate: t.st_rate ?? 0,
      // Not offered by the panel; a saved line keeps it.
      additional_tax: t.additional_tax ?? 0,
      narration1: t.narration1 ?? "",
    })),
  );
}

// What decides whether an invoice changed.
const signature = ({ pycd, invoice_no, dated, godown, lines }) =>
  JSON.stringify([
    Number(pycd) || null,
    text(invoice_no),
    dayKey(dated),
    Number(godown) || null,
    lines.map((l) => [Number(l.service_id), num(l.qty) || 1, num(l.rate), num(l.st_rate), num(l.additional_tax), text(l.narration1)]),
  ]);

const isBlankRow = (r) => !intOf(r?.service_id) && !intOf(r?.pycd) && !num(r?.rate) && !text(r?.invoice_no);

/**
 * Validate the panel and work out what to write. Call BEFORE the document is
 * written; throws 400 / 403 / 422 errors (statusCode) the route returns.
 * @param {object} p
 * @param {object[]|undefined} p.services body.services — undefined → null (leave alone)
 * @param {number} p.tranCode the document's tran_code (4 / 6)
 * @param {number|null} p.sourceTranId the saved document (edit) or null (create)
 * @param {object} p.master the document's clean master (dated, godown)
 * @param {object} p.session
 * @returns {Promise<null | { creates, updates, deletes, source }>}
 */
export async function planDocumentServices({ services, tranCode, sourceTranId = null, master, session }) {
  const source = DOCUMENT_SERVICE_SOURCES[Number(tranCode)];
  if (!source || !Array.isArray(services)) return null;

  const { owned } = sourceTranId ? await loadDocumentInvoices(sourceTranId) : { owned: [] };
  const ownedById = new Map(owned.map((inv) => [inv.tran_id, inv]));

  // ── Clean rows ─────────────────────────────────────────────
  const rows = [];
  services.forEach((raw, index) => {
    if (isBlankRow(raw)) return;
    const n = index + 1;
    const service_id = intOf(raw.service_id);
    const pycd = intOf(raw.pycd);
    if (!service_id) throw fail(`Services row ${n}: choose a service.`);
    if (!pycd) throw fail(`Services row ${n}: choose the vendor to bill.`);
    // if (num(raw.rate) <= 0) throw fail(`Services row ${n}: enter the rate.`);
    if (num(raw.qty) < 0) throw fail(`Services row ${n}: qty cannot be negative.`);
    const tran_id = intOf(raw.tran_id);
    if (tran_id && !ownedById.has(tran_id)) {
      throw fail(`Services row ${n}: service invoice ${tran_id} cannot be changed here — open it on the Service Invoice screen.`, 422);
    }
    rows.push({
      tran_id,
      service_id,
      pycd,
      invoice_no: text(raw.invoice_no).slice(0, 150),
      qty: num(raw.qty) || 1,
      rate: num(raw.rate),
      st_rate: num(raw.st_rate),
      additional_tax: num(raw.additional_tax),
      narration1: text(raw.narration1).slice(0, 250) || null,
    });
  });

  // ── Group: one invoice per vendor + vendor invoice no ───────
  // A saved row stays on its invoice while its vendor / invoice no match it;
  // new (or re-pointed) rows join the group with the same vendor + no.
  const groups = new Map();
  const vendorKey = (r) => `${r.pycd}|${r.invoice_no.toUpperCase()}`;
  const deferred = [];
  for (const r of rows) {
    const g = r.tran_id ? groups.get(`id:${r.tran_id}`) : null;
    if (r.tran_id && (!g || g.vendorKey === vendorKey(r))) {
      if (g) g.rows.push(r);
      else groups.set(`id:${r.tran_id}`, { tran_id: r.tran_id, vendorKey: vendorKey(r), rows: [r] });
    } else {
      deferred.push(r);
    }
  }
  for (const r of deferred) {
    const match = [...groups.values()].find((g) => g.vendorKey === vendorKey(r));
    if (match) match.rows.push(r);
    else groups.set(`new:${vendorKey(r)}`, { tran_id: null, vendorKey: vendorKey(r), rows: [r] });
  }

  // ── Price and compare ──────────────────────────────────────
  // A new invoice takes the document's date and godown; a saved one keeps its
  // own (a vendor's bill has its own date — imported ones too).
  const dated = master?.dated ? new Date(master.dated) : new Date();
  const godown = intOf(master?.godown);
  const creates = [];
  const updates = [];
  for (const g of groups.values()) {
    const existing = g.tran_id ? ownedById.get(g.tran_id) : null;
    const { pycd, invoice_no } = g.rows[0];
    const head = existing
      ? { pycd, invoice_no: invoice_no || null, dated: existing.dated ?? dated, godown: existing.godown ?? null }
      : { pycd, invoice_no: invoice_no || null, dated, godown };
    if (existing && signature({ ...existing, lines: existing.transactions }) === signature({ ...head, lines: g.rows })) {
      continue; // unchanged
    }
    const lines = await prepareServiceInvoice(g.rows, {
      keepServiceIds: new Set((existing?.transactions || []).map((t) => t.service_id)),
    });
    const auto = await serviceInvoiceAutoEntries(lines, head, g.tran_id);
    (existing ? updates : creates).push({ tran_id: g.tran_id, head, lines, auto, storedDated: existing?.dated ?? null });
  }
  const keptIds = new Set([...groups.values()].map((g) => g.tran_id).filter(Boolean));
  const deletes = owned.filter((inv) => !keptIds.has(inv.tran_id)).map((inv) => ({ tran_id: inv.tran_id, dated: inv.dated }));

  // ── Rights and period lock (tran_code 21) ──────────────────
  const need = [
    [creates.length, "serviceInvoice.create", "add service invoices"],
    [updates.length, "serviceInvoice.update", "change service invoices"],
    [deletes.length, "serviceInvoice.delete", "remove service invoices"],
  ];
  for (const [count, code, what] of need) {
    if (count && !(await can(session, code))) throw fail(`You may not ${what} (${code}).`, 403);
  }
  for (const c of creates) {
    const err = await checkPeriodLock(c.head.dated, SERVICE_TRAN_CODE, { action: "create" });
    if (err) throw fail(err, 422);
  }
  for (const u of updates) {
    const err = await checkPeriodLock([u.storedDated, u.head.dated], SERVICE_TRAN_CODE, { action: "update" });
    if (err) throw fail(err, 422);
  }
  for (const d of deletes) {
    const err = await checkPeriodLock(d.dated, SERVICE_TRAN_CODE, { action: "delete" });
    if (err) throw fail(err, 422);
  }

  return { source, creates, updates, deletes, userId: session?.user?.id ?? null };
}

/** True when a plan writes anything. */
export const hasServiceWork = (plan) =>
  !!plan && plan.creates.length + plan.updates.length + plan.deletes.length > 0;

// Next Service Invoice voucher no, serialised so two documents saved at once
// cannot take the same number (lock released with the transaction).
async function nextServiceVrNo(tx) {
  // $executeRaw: pg_advisory_xact_lock() returns void, which $queryRaw cannot read.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('vr_no:21'))`;
  const last = await tx.transactionsMaster.aggregate({
    where: { tran_code: SERVICE_TRAN_CODE },
    _max: { vr_no: true },
  });
  return (last._max.vr_no ?? 0) + 1;
}

const lineRows = (lines, tran_id) =>
  lines.map((l) => ({
    tran_id,
    sub_tran_id: 1,
    service_id: l.service_id,
    acno: l.acno,
    qty: l.qty,
    rate: l.rate,
    st_rate: l.st_rate,
    additional_tax: l.additional_tax,
    gross_amount: l.gross_amount,
    st_amount: l.st_amount,
    damt: l.damt,
    camt: 0,
    narration1: l.narration1 ?? null,
  }));

/**
 * Write a plan, inside the document's save transaction. `doc` is the saved
 * GRN / dispatch row (tran_id + its grn_no / dispatch_no).
 */
export async function syncDocumentServices(tx, doc, plan) {
  if (!hasServiceWork(plan)) return;
  const { source } = plan;
  const docNo = doc?.[source.field] ?? null;
  const link = [{ line_no: 0, source_tran_id: doc.tran_id, source_type: source.source_type }];
  const headerRefs = { grn_no: null, dispatch_no: null, [source.field]: docNo };

  for (const d of plan.deletes) {
    await clearVoucherAllocations(tx, d.tran_id);
    await tx.serviceInvoiceLink.deleteMany({ where: { tran_id: d.tran_id } });
    await tx.transactions.deleteMany({ where: { tran_id: d.tran_id } });
    await tx.transactionsMaster.delete({ where: { tran_id: d.tran_id } });
  }

  for (const u of plan.updates) {
    await tx.transactionsMaster.update({
      where: { tran_id: u.tran_id },
      data: { ...u.head, time: u.head.dated, ...headerRefs },
    });
    await clearVoucherAllocations(tx, u.tran_id);
    await tx.transactions.deleteMany({ where: { tran_id: u.tran_id } });
    await tx.transactions.createMany({
      data: [...lineRows(u.lines, u.tran_id), ...u.auto.map((row) => ({ ...row, tran_id: u.tran_id }))],
    });
    await syncServiceLinks(tx, u.tran_id, link);
  }

  if (plan.creates.length) {
    const names = await tx.service.findMany({
      where: { id: { in: [...new Set(plan.creates.flatMap((c) => c.lines.map((l) => l.service_id)))] } },
      select: { id: true, service_name: true },
    });
    const nameOf = new Map(names.map((s) => [s.id, s.service_name]));
    let vr_no = await nextServiceVrNo(tx);
    for (const c of plan.creates) {
      const services = [...new Set(c.lines.map((l) => nameOf.get(l.service_id)).filter(Boolean))].join(", ");
      const created = await tx.transactionsMaster.create({
        data: {
          tran_code: SERVICE_TRAN_CODE,
          vr_no: vr_no++,
          ...c.head,
          time: c.head.dated,
          check_date: null,
          ...headerRefs,
          rmk: `${services} — ${source.label} ${docNo ?? doc.tran_id}`.slice(0, 500),
          user_id: plan.userId,
        },
      });
      await tx.transactions.createMany({
        data: [...lineRows(c.lines, created.tran_id), ...c.auto.map((row) => ({ ...row, tran_id: created.tran_id }))],
      });
      await syncServiceLinks(tx, created.tran_id, link);
    }
  }
}

/** Refuse deleting a GRN / dispatch that still has service invoices. */
export async function documentServicesDeleteError(tran_id, tran_code, { db = prisma } = {}) {
  const source = DOCUMENT_SERVICE_SOURCES[Number(tran_code)];
  if (!source) return null;
  const links = await db.serviceInvoiceLink.findMany({
    where: { source_tran_id: Number(tran_id) },
    select: { tran_id: true },
    distinct: ["tran_id"],
  });
  if (!links.length) return null;
  return `This ${source.label} has ${links.length} service invoice${links.length === 1 ? "" : "s"} — remove them from its Services panel (or the Service Invoice screen) first.`;
}

/**
 * Last vendor / rate / ST % billed per service on this kind of document, so a
 * new panel row is filled as soon as the service is picked.
 * @returns {Promise<Map<number, { pycd, vendor, rate, st_rate }>>}
 */
export async function lastServiceDefaults(sourceType, { db = prisma } = {}) {
  const rows = await db.$queryRaw`
    SELECT DISTINCT ON (t.service_id)
      t.service_id, m.pycd, a.acname, t.rate, t.st_rate
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" m ON m.tran_id = t.tran_id
    LEFT JOIN "acno" a ON a.acno = m.pycd
    WHERE m.tran_code = 21
      AND t.sub_tran_id = 1
      AND t.service_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM service_invoice_links l
        WHERE l.tran_id = m.tran_id AND l.source_type = ${sourceType}
      )
    ORDER BY t.service_id, m.dated DESC, m.tran_id DESC`;
  return new Map(
    rows.map((r) => [
      Number(r.service_id),
      { pycd: r.pycd != null ? Number(r.pycd) : null, vendor: r.acname ?? "", rate: Number(r.rate) || 0, st_rate: Number(r.st_rate) || 0 },
    ]),
  );
}

/**
 * The row a NEW document's Services panel starts with, so the user only
 * types the amount: the service this document type uses most (e.g. FREIGHT -
 * SALES on a dispatch) and the vendor it is most often billed to, over the
 * last 180 days (all time when nothing recent), with that pair's latest ST %.
 * Worked out from the data — no setting, nothing hard-coded. null when the
 * document type has no services yet. An untouched default row (no rate
 * typed) is not saved (Form.jsx).
 */
export async function defaultServiceRow(sourceType, { db = prisma } = {}) {
  const pick = (since) => db.$queryRaw`
    WITH used AS (
      SELECT t.service_id, m.pycd, m.dated, m.tran_id, t.st_rate
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" m ON m.tran_id = t.tran_id
      WHERE m.tran_code = 21
        AND t.sub_tran_id = 1
        AND t.service_id IS NOT NULL
        AND m.pycd IS NOT NULL
        AND (${since}::timestamp IS NULL OR m.dated >= ${since}::timestamp)
        AND EXISTS (
          SELECT 1 FROM service_invoice_links l
          WHERE l.tran_id = m.tran_id AND l.source_type = ${sourceType}
        )
    ),
    top_service AS (
      SELECT u.service_id FROM used u
      JOIN "Service" s ON s.id = u.service_id AND s.is_active = true
      GROUP BY u.service_id ORDER BY COUNT(DISTINCT u.tran_id) DESC, u.service_id LIMIT 1
    ),
    top_vendor AS (
      SELECT u.pycd FROM used u JOIN top_service ts ON ts.service_id = u.service_id
      GROUP BY u.pycd ORDER BY COUNT(DISTINCT u.tran_id) DESC, MAX(u.dated) DESC LIMIT 1
    )
    SELECT u.service_id, s.service_name, u.pycd, a.acname, u.st_rate
    FROM used u
    JOIN top_service ts ON ts.service_id = u.service_id
    JOIN top_vendor tv ON tv.pycd = u.pycd
    JOIN "Service" s ON s.id = u.service_id
    LEFT JOIN "acno" a ON a.acno = u.pycd
    ORDER BY u.dated DESC, u.tran_id DESC
    LIMIT 1`;
  const since = new Date(Date.now() - 180 * 24 * 3600 * 1000);
  let [row] = await pick(since);
  if (!row) [row] = await pick(null);
  if (!row) return null;
  return {
    service_id: Number(row.service_id),
    service_name: row.service_name || `Service ${row.service_id}`,
    pycd: Number(row.pycd),
    vendor: row.acname ?? "",
    st_rate: Number(row.st_rate) || "",
  };
}
