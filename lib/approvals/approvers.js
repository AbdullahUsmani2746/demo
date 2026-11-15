// lib/approvals/approvers.js — who approves an approval rule. Kept apart from
// lib/approvals/rules.js (which loads the form configs) so light readers —
// follow-ups, their cron — can ask without loading every voucher form.
import prisma from "@/lib/prisma";
import { usersWithRoles } from "@/lib/auth/roles";

const arr = (v) => (Array.isArray(v) ? v : []);

/** Active users who may decide on this rule's requests (its people + its roles). */
export async function ruleApproverIds(rule) {
  const users = arr(rule?.approver_users).map(String);
  const roles = arr(rule?.approver_roles);
  const or = [];
  if (users.length) or.push({ id: { in: users } });
  if (roles.length) or.push(usersWithRoles(roles));
  if (!or.length) return [];
  const rows = await prisma.user.findMany({ where: { isActive: true, OR: or }, select: { id: true } });
  return rows.map((r) => r.id);
}
