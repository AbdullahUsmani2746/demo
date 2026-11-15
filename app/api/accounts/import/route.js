// app/api/accounts/import/route.js
// ============================================================
// Chart of accounts — Excel import (Add Account page → Import).
//
// POST { level: "acno" | "macno", rows: [{ row, ...fields }], dryRun? }
//   → { created, results: [{ row, ok, code?, error? }] }
//
// Same right as the single create (account.manage on POST
// /api/accounts/acno and /api/accounts/macno). Every row is checked first:
// required fields, types / lengths (lib/accounts/importColumns.js), the
// parent exists, and the name is not repeated under the same parent —
// neither in the file nor in the books. A dry run only reports. A real run
// writes nothing unless every row is valid, then creates them all in one
// transaction through `prisma` (audited), each getting the next code from
// the database exactly as the single create does.
// ============================================================
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { IMPORT_LEVELS, normalizeImportRow, dupKey } from "@/lib/accounts/importColumns";

const MAX_ROWS = 2000;

// guard("account.manage") has already set the audit actor (setAuditActor).
export const POST = guard("account.manage", async (request) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the rows as JSON" }, { status: 400 });
  }
  const { level, rows, dryRun = false } = body || {};
  const def = IMPORT_LEVELS[level];
  if (!def) return NextResponse.json({ error: 'level must be "acno" or "macno"' }, { status: 400 });
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: "There are no rows to import" }, { status: 400 });
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `At most ${MAX_ROWS} rows can be imported at once — split the file` }, { status: 400 });
  }

  try {
    // 1) Each row's own fields.
    const checked = rows.map((raw, i) => {
      const { data, errors } = normalizeImportRow(level, raw);
      return { row: Number(raw?.row) || i + 2, data, errors };
    });

    // 2) Against the database: parents, tax laws, names already there.
    const parentIds = [...new Set(checked.map((r) => r.data[def.parentKey]).filter((v) => v != null))];
    const parentModel = level === "acno" ? prisma.mACNO : prisma.bSCD;
    const parents = parentIds.length
      ? await parentModel.findMany({ where: { [def.parentKey]: { in: parentIds } }, select: { [def.parentKey]: true } })
      : [];
    const parentSet = new Set(parents.map((p) => p[def.parentKey]));

    let taxLawSet = new Set();
    if (level === "acno") {
      const codes = [...new Set(checked.map((r) => r.data.tax_law_code).filter((v) => v != null))];
      if (codes.length) {
        const laws = await prisma.taxLaws.findMany({ where: { tax_law_code: { in: codes } }, select: { tax_law_code: true } });
        taxLawSet = new Set(laws.map((l) => l.tax_law_code));
      }
    }

    // Existing names under the same parents. (ACNO reads follow "Hide off
    // books" — while it is on, an off-book account's name is not seen here.)
    const siblingModel = level === "acno" ? prisma.aCNO : prisma.mACNO;
    const existing = parentSet.size
      ? await siblingModel.findMany({
          where: { [def.parentKey]: { in: [...parentSet] } },
          select: { [def.parentKey]: true, [def.nameKey]: true, [level]: true },
        })
      : [];
    const existingByName = new Map(existing.map((e) => [dupKey(e[def.parentKey], e[def.nameKey]), e[level]]));

    // 3) Names repeated within the file (first one wins, the others fail).
    const firstRowByName = new Map();
    for (const r of checked) {
      const parent = r.data[def.parentKey];
      const name = r.data[def.nameKey];
      if (parent == null || !name) continue;
      if (!parentSet.has(parent)) {
        r.errors.push(`${def.parentTitle} ${parent} does not exist`);
        continue;
      }
      const key = dupKey(parent, name);
      if (existingByName.has(key)) r.errors.push(`"${name}" already exists under ${parent} (code ${existingByName.get(key)})`);
      else if (firstRowByName.has(key)) r.errors.push(`"${name}" is repeated — same as row ${firstRowByName.get(key)}`);
      else firstRowByName.set(key, r.row);
    }
    if (level === "acno") {
      for (const r of checked) {
        if (r.data.tax_law_code != null && !taxLawSet.has(r.data.tax_law_code)) r.errors.push(`Tax law code ${r.data.tax_law_code} does not exist`);
      }
    }

    const results = checked.map((r) => (r.errors.length ? { row: r.row, ok: false, error: r.errors.join("; ") } : { row: r.row, ok: true }));
    const invalid = results.filter((r) => !r.ok).length;

    if (dryRun || invalid) {
      return NextResponse.json(
        { created: 0, dryRun: !!dryRun, valid: results.length - invalid, invalid, results },
        { status: dryRun || !invalid ? 200 : 400 },
      );
    }

    // 4) All valid — one transaction, all or nothing. The fields and defaults
    // are the single create's (isActive from the schema default, lock false
    // unless the file says Yes).
    const codes = await prisma.$transaction(
      async (tx) => {
        const out = [];
        for (const r of checked) {
          if (level === "acno") {
            const created = await tx.aCNO.create({ data: r.data, select: { acno: true } });
            out.push(created.acno);
          } else {
            const created = await tx.mACNO.create({ data: { macname: r.data.macname, bscd: r.data.bscd }, select: { macno: true } });
            out.push(created.macno);
          }
        }
        return out;
      },
      { maxWait: 10000, timeout: Math.min(120000, Math.max(15000, checked.length * 60)) },
    );

    return NextResponse.json({
      created: codes.length,
      results: checked.map((r, i) => ({ row: r.row, ok: true, code: Number(codes[i]) })),
    });
  } catch (error) {
    console.error("Account import failed:", error);
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "A code already exists — nothing was imported. Try again." }, { status: 400 });
    }
    return NextResponse.json({ error: "Import failed — nothing was imported" }, { status: 500 });
  }
});
