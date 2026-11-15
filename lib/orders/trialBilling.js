// lib/orders/trialBilling.js — Trial / Rate Negotiation items the client approved
// (feature "orders.trialLineBilling", ported from Eastland). SERVER ONLY.
//
// There is no separate "trial result": the client's approval IS the Sale
// Order edit that turns a Trial / Rate Negotiation line into Normal with its
// rate (the edit goes through the approval rules like any Sale Order edit).
// Once such a line has dispatched qty, that qty is ready to bill on Sale
// Invoicing → Approved trial items (lib/dispatch/trialBilling.js). The order's
// open Trial follow-up hears about it too: closed as "Customer approved" when
// nothing is left on trial, else a note on it.
import prisma from "@/lib/prisma";
import { LINE_TYPE, WAITING_LINE_TYPES } from "@/lib/orders/lineTypes";
import { logFollowup } from "@/lib/bi/followups";

const waiting = (t) => WAITING_LINE_TYPES.includes(t);
const typeOf = (l) => l?.line_type?.value ?? l?.line_type ?? LINE_TYPE.NORMAL;
const itemOf = (l) => Number(l?.itcd?.value ?? l?.itcd);

/**
 * After a Sale Order edit: the lines that went from Trial / Rate Negotiation
 * to Normal with a rate and are already (partly) dispatched.
 *   before  the stored lines ({ itcd, line_type }) read before the save
 *   after   the lines as saved
 *   → { items: [{ itcd, name, dispatched_kg }], message } — message null when none
 */
export async function approvedTrialItems({ orderNo, before, after, session = null }) {
  const was = new Map(before.map((l) => [itemOf(l), typeOf(l)]));
  const turned = after.filter((l) => typeOf(l) === LINE_TYPE.NORMAL && Number(l.rate) > 0 && waiting(was.get(itemOf(l))));
  if (!turned.length) return { items: [], message: null };
  const itcds = turned.map(itemOf);
  const [sent, names] = await Promise.all([
    prisma.transactions.groupBy({
      by: ["itcd"],
      where: { itcd: { in: itcds }, sub_tran_id: 1, transactionsMaster: { tran_code: 6, so_no: Number(orderNo) } },
      _sum: { qty: true },
    }),
    // names of every item on the order — the follow-up note lists those still on trial too
    prisma.item.findMany({ where: { itcd: { in: [...new Set(after.map(itemOf).filter(Number.isFinite))] } }, select: { itcd: true, code: true, item: true } }),
  ]);
  const nameOf = new Map(names.map((i) => [i.itcd, `${i.code ? `${i.code} · ` : ""}${i.item}`]));

  await noteOnTrialFollowups({
    orderNo,
    approved: itcds.map((i) => nameOf.get(i) || `Item ${i}`),
    stillOnTrial: after.filter((l) => waiting(typeOf(l))).map((l) => nameOf.get(itemOf(l)) || l.item_name || `Item ${itemOf(l)}`),
    session,
  }).catch((e) => console.error("[trial] follow-up note failed:", e?.message));

  const items = sent
    .filter((s) => Number(s._sum.qty) > 0)
    .map((s) => ({ itcd: s.itcd, name: nameOf.get(s.itcd) || `Item ${s.itcd}`, dispatched_kg: Number(s._sum.qty) }));
  if (!items.length) return { items, message: null };
  const list = items.map((i) => `${i.name} (${i.dispatched_kg.toLocaleString("en-US", { maximumFractionDigits: 3 })} KG)`).join(", ");
  return {
    items,
    message: `${items.length} trial item${items.length === 1 ? "" : "s"} approved by the client and already dispatched — ready to bill on Sale Invoicing → Approved trial items: ${list}.`,
  };
}

/**
 * The order's open Trial follow-ups (BI scenarios on Sale Orders whose
 * question filters Order Type = Trial Process; item = the SO no.):
 *   · nothing left on trial → logged "Customer approved", which closes it
 *   · items still on trial → a note on it; it stays open for those
 */
async function noteOnTrialFollowups({ orderNo, approved, stillOnTrial, session }) {
  const open = await prisma.biFollowup.findMany({
    where: { item_key: String(orderNo), status: "open", question: { dataset: "so_followup" } },
    select: { id: true, question: { select: { config: true } } },
  });
  const trial = open.filter((f) => JSON.stringify(f.question?.config ?? {}).includes("Trial Process"));
  if (!trial.length) return;
  const userId = session?.user?.id ? String(session.user.id) : null;
  const userName = session?.user?.name || session?.user?.email || null;
  const remarks = `Approved on the Sale Order: ${approved.join(", ")} changed to Normal with the agreed rate.`;
  for (const f of trial) {
    if (!stillOnTrial.length) {
      await logFollowup({ id: f.id, userId, userName, result: "approved", remarks: `${remarks} Nothing left on trial.` });
    } else {
      await prisma.biFollowupNote.create({
        data: { followup_id: f.id, user_id: userId, result: null, remarks: `${remarks} Still on trial: ${stillOnTrial.join(", ")}.`.slice(0, 1000) },
      });
    }
  }
}
