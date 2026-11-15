// lib/approvals/access.js — may this session open / act on an approval?
// One rule for the page, its API and the menu: holding any of the approval's
// rights (lib/approvals/catalog.js). Super Admin passes, as everywhere.
import prisma from "@/lib/prisma";
import { can } from "@/lib/auth/permissions";
import { canDecide, FLAG_FORMS } from "@/lib/approvals/rules";
import { APPROVALS, approvalCodes } from "@/lib/approvals/catalog";

export const approvalByKey = (key) => APPROVALS.find((a) => a.key === key);

/** True when the session holds the approval's main right or any extra right. */
export async function canOpenApproval(session, key) {
  const a = approvalByKey(key);
  if (!a || !session?.user?.id) return false;
  for (const code of approvalCodes(a)) if (await can(session, code)) return true;
  // Sale Orders: also an approver of any "Save, but block dispatch" rule — the
  // Free of Cost / Trial / bad-customer reasons are rules now.
  if (FLAG_FORMS.includes(key)) {
    try {
      const rules = await prisma.approvalRule.findMany({ where: { doc_type: key, mode: "flag", is_active: true } });
      if (rules.some((r) => canDecide(session, r))) return true;
    } catch {
      // rules not set up yet
    }
  }
  return false;
}

/** Page paths of approvals this session may NOT open (to hide from the menu). */
export async function hiddenApprovalPages(session) {
  const out = [];
  for (const a of APPROVALS) {
    if (a.gatesPage === false) continue; // the page is everyone's; only an action is gated
    if (!(await canOpenApproval(session, a.key))) out.push(a.page, ...(a.legacyPages || []));
  }
  return out;
}
