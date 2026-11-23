// lib/fixedAssets/voucher.js — what app/api/voucher/[type] does for the fixed
// asset documents (kept here so the shared route only calls in):
//
//   saveFixedAssetVoucher()    POST of a Fixed Asset Disposal (15) / Relocation (16)
//   registerGrnAssets()        inside a Fixed Assets GRN's (14) save transaction
//   fixedAssetDocumentError()  edit / delete refusals:
//                                14 whose assets are registered — locked
//                                15 never (reverse it on the register instead)
//                                16 never (a new relocation moves it again)
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { getFaSettings } from "@/lib/fixedAssets/settings";
import { registerFromGrn, grnHasAssets } from "@/lib/fixedAssets/register";
import { planDisposal, applyDisposal, planRelocation, applyRelocation } from "@/lib/fixedAssets/disposal";
import { FaError, faErrorBody } from "@/lib/fixedAssets/errors";

const toInt = (v) => {
  const n = parseInt(v?.value ?? v, 10);
  return Number.isFinite(n) ? n : null;
};
const actorOf = (session) => session?.user?.id ?? null;

export const FIXED_ASSET_TRAN_CODES = new Set([15, 16]);

/** Edit / delete refusal for a stored fixed-asset document, or null. */
export async function fixedAssetDocumentError(stored, tranId) {
  const code = Number(stored?.tran_code);
  if (code === 14 && tranId && (await grnHasAssets(tranId))) {
    return "The assets of this GRN are in the Fixed Asset Register — the GRN can no longer be edited or deleted. Change an asset's life, method or salvage on the register; dispose of an asset (Scrap) to take it out.";
  }
  if (code === 15) return "A fixed asset disposal is never edited or deleted — reverse it from Fixed Assets → Register (Reverse disposal).";
  if (code === 16) return "A relocation is kept as the asset's history — post a new relocation to move the asset again.";
  return null;
}

/** Fixed Assets GRN saved: register its units (feature "fixedAssets.autoRegisterFromGrn"). */
export async function registerGrnAssets(tx, grnTranId, session) {
  if (!(await feature("fixedAssets.autoRegisterFromGrn"))) return null;
  return registerFromGrn(tx, grnTranId, { actor: actorOf(session), settings: await getFaSettings() });
}

async function nextVrNo(tx, tranCode) {
  const last = await tx.transactionsMaster.findFirst({ where: { tran_code: tranCode, vr_no: { not: null } }, orderBy: { vr_no: "desc" }, select: { vr_no: true } });
  return (last?.vr_no ?? 0) + 1;
}

/**
 * POST of a disposal / relocation voucher (period lock and approval rules
 * were checked by the route). Returns { status, body }.
 */
export async function saveFixedAssetVoucher({ tran_code, body, session }) {
  try {
    const master = body?.master ?? {};
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    const actor = actorOf(session);
    if (tran_code === 16 && !(await feature("fixedAssets.relocation"))) {
      throw new FaError("Fixed Asset Relocation is switched off (Settings → Features → Fixed assets).", 403);
    }
    const plan = tran_code === 15
      ? await planDisposal({ master, lines }, {
          depreciation: await feature("fixedAssets.depreciation"),
          posting: await feature("fixedAssets.disposalPosting"),
        })
      : await planRelocation({ master, lines });
    const day = new Date(`${plan.date}T00:00:00.000Z`);
    const itcdOf = (no) => plan.items.find((x) => x.asset.asset_no === no)?.asset.itcd ?? null;

    const result = await prisma.$transaction(
      async (tx) => {
        const voucher = await tx.transactionsMaster.create({
          data: {
            tran_code, vr_no: await nextVrNo(tx, tran_code), dated: day, time: day, check_date: day,
            pycd: tran_code === 15 ? plan.party : null,
            rmk: master.rmk ? String(master.rmk).slice(0, 1000) : null,
            rmk1: tran_code === 15 ? plan.kind : null,
            user_id: actor,
          },
        });
        await tx.transactions.createMany({
          data: plan.items.map((x) => {
            const no = x.asset.asset_no;
            return tran_code === 15
              ? { tran_id: voucher.tran_id, sub_tran_id: 1, itcd: itcdOf(no), party_name: String(no), qty: 1, rate: x.proceeds, camt: x.proceeds, narration1: `NBV ${x.nbv} · gain/loss ${x.gain_loss}` }
              : {
                  tran_id: voucher.tran_id, sub_tran_id: 1, itcd: itcdOf(no), party_name: String(no), qty: 1,
                  narration3: x.to.location_id != null ? String(x.to.location_id) : null,
                  narration4: x.to.department_id != null ? String(x.to.department_id) : null,
                  narration5: x.to.employee_id != null ? String(x.to.employee_id) : null,
                };
          }),
        });
        if (tran_code === 15) {
          const res = await applyDisposal(tx, voucher, plan, { actor });
          return { voucher, journal: res.journal, disposals: res.disposals };
        }
        await applyRelocation(tx, voucher, plan, { actor, remarks: master.rmk });
        return { voucher, journal: null };
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
    return {
      status: 201,
      body: {
        message: tran_code === 15 ? "Disposal saved" : "Relocation saved",
        voucherId: result.voucher.tran_id,
        vrNo: result.voucher.vr_no,
        journal: result.journal,
        disposals: result.disposals?.map((d) => ({ asset_id: d.asset_id, cost: d.cost, accumulated: d.accumulated, nbv: d.nbv, proceeds: d.proceeds, gain_loss: d.gain_loss })),
      },
    };
  } catch (error) {
    const known = faErrorBody(error);
    if (known) return known;
    throw error;
  }
}

export { toInt, faErrorBody };
