import prisma from "@/lib/prisma";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { getMinRecoveryMap } from "@/lib/salesTargets/minRecovery";

// The month's row key — the same as the Sales Targets route and the month-end
// job here (local midnight of the 1st).
const monthKey = (year, month) => new Date(Number(year), Number(month) - 1, 1);

/* ══════════════════════════════════════════════════════════════════════
   TARGET RECOVERY IS SET BY THE SYSTEM

   A customer's monthly Target Recovery is not typed in: it is the minimum
   from lib/salesTargets/minRecovery.js — the month's Opening OverDue × the
   customer's category share (BAD-DEBTS 25%, BAD-PAYMENTS 40%, others 100%).
   This writes it onto CustomerMonthlyTarget so the Sales Team MIS, the
   report engine and BI keep reading the same stored column.

   Run by: the Sales Targets page (for the customers it lists), the 1st-of-
   month cron (every customer, the new month) and the month-end run (just
   before it locks). A month already locked (lockedAt set) is left alone — its
   targets are part of the frozen month-end picture — except by the month-end
   run itself (includeLocked), which re-freezes the whole month.

   Only rows whose stored value differs are written, so a re-run is cheap
   and leaves no audit noise.
   ══════════════════════════════════════════════════════════════════════ */
export async function syncTargetRecovery({ year, month, customers = null, includeLocked = false }) {
  if (!Number(year) || !Number(month)) return { written: 0, minByAcno: new Map() };
  const dated = monthKey(year, month);

  const list =
    customers ??
    (await prisma.aCNO.findMany({
      where: { macno: { in: await getCustomerMacnos() } },
      select: { acno: true, customerStatus: true, isActive: true },
    }));
  const minByAcno = await getMinRecoveryMap({ customers: list, year, month });
  if (!list.length) return { written: 0, minByAcno };

  const existing = await prisma.customerMonthlyTarget.findMany({
    where: { acno: { in: list.map((c) => c.acno) }, dated },
    select: { acno: true, targetRecovery: true, lockedAt: true },
  });
  const rowByAcno = new Map(existing.map((t) => [t.acno, t]));

  const writes = [];
  for (const c of list) {
    const target = minByAcno.get(c.acno)?.minRecovery ?? 0;
    const row = rowByAcno.get(c.acno);
    if (row?.lockedAt && !includeLocked) continue; // frozen with its month
    const stored = row?.targetRecovery == null ? null : Number(row.targetRecovery);
    // No row and nothing to recover: nothing to store.
    if (!row && target === 0) continue;
    if (stored !== null && Math.abs(stored - target) < 0.005) continue;
    writes.push({ acno: c.acno, target });
  }

  const CHUNK = 50;
  for (let i = 0; i < writes.length; i += CHUNK) {
    await prisma.$transaction(
      writes.slice(i, i + CHUNK).map(({ acno, target }) =>
        prisma.customerMonthlyTarget.upsert({
          where: { acno_dated: { acno, dated } },
          update: { targetRecovery: target },
          create: { acno, dated, targetRecovery: target },
        }),
      ),
    );
  }
  return { written: writes.length, minByAcno };
}
