// lib/fixedAssets/accounts.js — the posting accounts of a fixed-asset
// category: its own (fa_category_defaults, Settings → Fixed assets), else the
// company default in Finance → Account Settings → Fixed Assets. Never a
// hard-coded account (CLAUDE.md rule 0).
import prisma from "@/lib/prisma";
import { getAccount } from "@/lib/accounts/accountSettings";
import { FA_CATEGORY_ACCOUNTS } from "@/lib/fixedAssets/settingsDefs";
import { FaError } from "@/lib/fixedAssets/errors";

/** ic_id → { cost, accdep, depexp, gainloss, name } (null where not set anywhere). */
export async function categoryAccounts(icIds, db = prisma) {
  const ids = [...new Set(icIds.filter((x) => x != null).map(Number))];
  const [rows, cats, defaults] = await Promise.all([
    ids.length ? db.faCategoryDefault.findMany({ where: { ic_id: { in: ids } } }) : [],
    ids.length ? db.itemCategory.findMany({ where: { id: { in: ids } }, select: { id: true, ic_name: true } }) : [],
    Promise.all(FA_CATEGORY_ACCOUNTS.map((a) => getAccount(a.key))),
  ]);
  const own = new Map(rows.map((r) => [r.ic_id, r]));
  const names = new Map(cats.map((c) => [c.id, c.ic_name]));
  const out = new Map();
  for (const id of [...ids, null]) {
    const r = id == null ? null : own.get(id);
    const acc = { name: id == null ? "(no category)" : names.get(id) ?? `Category ${id}` };
    FA_CATEGORY_ACCOUNTS.forEach((a, i) => {
      acc[a.col.replace("_acno", "")] = r?.[a.col] ?? defaults[i] ?? null;
    });
    out.set(id, acc);
  }
  return out;
}

const LABEL = Object.fromEntries(FA_CATEGORY_ACCOUNTS.map((a) => [a.col.replace("_acno", ""), a.label]));

/** The account or a 422 naming where to set it. */
export function needAccount(accounts, icId, which) {
  const acc = accounts.get(icId == null ? null : Number(icId)) ?? accounts.get(null);
  const acno = acc?.[which];
  if (acno == null) {
    throw new FaError(
      `Set the "${LABEL[which]}" account for fixed-asset category "${acc?.name ?? icId}" (Settings → Fixed assets) or its default in Finance → Account Settings → Fixed Assets.`,
      422,
    );
  }
  return acno;
}
