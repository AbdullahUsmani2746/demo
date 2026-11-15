// lib/auth/menuPermissions.js — the work a person's Employee menus give them.
//
// A screen assigned to someone (Settings → Employee menus, employee_menu +
// every menu under it) lets them view, add, edit and print on that screen,
// plus read what the screen looks up (a dispatch reads its sale orders).
// Delete, approve, unlock, post, pay and every "manage everything" right
// stay with roles (Admin → Roles). This is the lowest layer in
// resolve() (lib/auth/permissions.js): a deny on the person or their role wins.
import prisma from "@/lib/prisma";

const DOC = ["view", "create", "update", "print"];
const doc = (type) => DOC.map((a) => `${type}.${a}`);

// What a document screen also reads (lookups on the form).
const RELATED = {
  dispatch: ["saleOrder.view", "saleOrderView.view"],
  dispatchEdit: ["saleOrder.view", "saleOrderView.view", "dispatch.view"],
  saleReturn: ["dispatch.view", "dispatchEdit.view"],
  dispatchReturn: ["dispatch.view", "dispatchEdit.view"],
  grn: ["purchaseOrder.view", "purchaseOrderEdit.view"],
  grnEdit: ["purchaseOrder.view", "purchaseOrderEdit.view", "grn.view"],
  grnReturn: ["grn.view", "grnEdit.view"],
  serviceEntry: ["serviceOrder.view"],
  serviceInvoice: ["serviceOrder.view", "serviceEntry.view"],
  materialIssue: ["requisition.view", "productionPlan.view"],
};

const INVOICING_RELATED = {
  sale: ["dispatch.view", "dispatchEdit.view"],
  "sale-return": ["saleReturn.view", "dispatchReturn.view"],
  purchase: ["grn.view", "grnEdit.view"],
  "purchase-return": ["grnReturn.view"],
};

const HR = {
  dashboard: ["hr.attendance.view"],
  attendance: ["hr.attendance.view", "hr.attendance.mark"],
  leave: ["hr.leave.view", "hr.leave.manage"],
  loans: ["hr.loan.view", "hr.loan.manage"],
  payroll: ["hr.payroll.view", "hr.payroll.manage"],
  salary: ["hr.salary.view", "hr.salary.manage"],
  shifts: ["hr.shifts.manage", "hr.holidays.manage"],
  team: ["hr.team.manage"],
};

const FIXED = {
  "/accounting/godown/transfer": [...doc("transfer"), ...doc("transferEdit")],
  "/accounting/forms/customer": ["customer.create", "customer.update"],
  "/accounting/forms/items": ["setup.items.view", "setup.items.manage"],
  "/accounting/add-account": ["account.manage"],
  "/accounting/show-account": ["account.manage"],
  "/accounting/checks-in-hand": ["account.manage"],
  "/accounting/knockoff-review": ["knockoff.run", "knockoff.allocate"],
  "/accounting/bi-designer": ["bi.design"],
  "/accounting/material?tab=bom": ["bom.manage"],
  // Planned quantities (INPUT_FOR_PP) — a planning input of the Production Planning report
  "/accounting/planned-quantities": ["report.productionPlanning.view", "plannedQty.manage"],
  "/accounting/material?tab=production": doc("productionPlan"),
  "/pos": ["pos.manage"],
  // Read-only costing checks (feature costing.reconciliation)
  "/accounting/costing/reconciliation": ["costing.reconcile"],
  "/accounting/costing/item-reconciliation": ["costing.reconcile"],
};

/** Permission codes one menu URL gives. Pure — exported for the Roles screen and tests. */
export function codesForMenuUrl(rawUrl) {
  if (!rawUrl || rawUrl === "#") return [];
  const url = String(rawUrl).trim().replace(/\/$/, "");
  if (FIXED[url]) return FIXED[url];
  const path = url.split("?")[0];
  if (FIXED[path]) return FIXED[path];
  let m;
  if ((m = path.match(/^\/accounting\/(?:voucher|report|order|return|invoice|production)\/([A-Za-z]+)$/))) {
    return [...doc(m[1]), ...(RELATED[m[1]] || [])];
  }
  if ((m = path.match(/^\/accounting\/reports\/([A-Za-z_]+)$/))) return [`report.${m[1]}.view`, "export.excel", "export.pdf"];
  if ((m = path.match(/^\/accounting\/setup\/([a-z_]+)$/))) return [`setup.${m[1]}.view`, `setup.${m[1]}.manage`];
  if ((m = path.match(/^\/accounting\/invoicing\/([a-z-]+)$/))) {
    return [`invoicing.${m[1]}.view`, `invoicing.${m[1]}.generate`, ...(INVOICING_RELATED[m[1]] || [])];
  }
  if ((m = path.match(/^\/accounting\/hr\/([a-z]+)$/))) return HR[m[1]] || [];
  if (path.startsWith("/accounting/costing")) return ["costing.manage"];
  return [];
}

const TTL_MS = 60 * 1000;
const cache = new Map(); // employeeId → { at, codes }

async function menuUrlsOfEmployee(employeeId) {
  const direct = await prisma.employee_menu.findMany({ where: { employee_id: employeeId }, select: { menu_id: true } });
  if (!direct.length) return [];
  const all = await prisma.menus.findMany({ where: { is_active: true }, select: { id: true, parent_id: true, url: true } });
  const kids = new Map();
  for (const m of all) {
    if (m.parent_id == null) continue;
    if (!kids.has(m.parent_id)) kids.set(m.parent_id, []);
    kids.get(m.parent_id).push(m.id);
  }
  const byId = new Map(all.map((m) => [m.id, m]));
  const seen = new Set();
  const stack = direct.map((d) => d.menu_id);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const k of kids.get(id) || []) stack.push(k);
  }
  return [...seen].map((id) => byId.get(id)?.url).filter(Boolean);
}

async function employeeIdOf(user) {
  if (user.employeeId) return Number(user.employeeId);
  const u = await prisma.user.findUnique({ where: { id: String(user.id) }, select: { employeeId: true, email: true } });
  if (u?.employeeId) return u.employeeId;
  if (!u?.email) return null;
  const e = await prisma.employee.findUnique({ where: { emailAddress: u.email }, select: { id: true } });
  return e?.id ?? null;
}

/** Codes the session's Employee menus give (a Set; cached a minute per employee). */
export async function menuPermissionCodes(session) {
  const user = session?.user;
  if (!user?.id) return new Set();
  const employeeId = await employeeIdOf(user);
  if (!employeeId) return new Set();
  const hit = cache.get(employeeId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.codes;
  const urls = await menuUrlsOfEmployee(employeeId);
  const codes = new Set(urls.flatMap(codesForMenuUrl));
  cache.set(employeeId, { at: Date.now(), codes });
  return codes;
}
