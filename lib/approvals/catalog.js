// lib/approvals/catalog.js — every approval in the ERP, in one list.
//
// An approval is managed entirely on Admin → Permissions → Approvals: tick who
// may approve (by person or by role). That one grant (the `permission` below)
// then decides, everywhere:
//   · who can open the approval page          (page + its API refuse others;
//                                              the menu item hides for others)
//   · who can approve / reject                (the API)
//   · who is notified when one is waiting     (lib/approvals/holders.js)
// Nothing about approvers is written in code any more.
//
// To add an approval: one entry here (+ its permission code in
// scripts/seed-permissions.mjs, then `node scripts/seed-permissions.mjs --apply`).
// No imports — the browser reads this file too.

export const APPROVALS = [
  {
    key: "saleOrder",
    label: "Sale Order approval",
    description:
      "Sale Orders that need approval: Free of Cost, Trial Process, Rate Under Negotiation, Despatch Without Godown, No Godown, Bad-Debt / Bad-Payment customer. Approve or reject with a reason.",
    permission: "saleOrder.approve",
    // Decided in the Approvals inbox, beside every other request.
    page: "/dashboard/approvals?type=saleOrder",
    // The retired page (it redirects) — its menu item still hides for others.
    legacyPages: ["/accounting/forms/saleOrderApprovals"],
    rights: [],
  },
  {
    key: "saleReturn",
    label: "Sale Return review",
    description:
      "Reasons the sales person gives for a Sale Return (Technical / Commercial). Reviewers read every reason; remarks can be written by those given the remark right.",
    permission: "saleReturn.approve",
    page: "/accounting/forms/saleReturnApprovals",
    rights: [{ code: "saleReturn.remark", label: "May write review remarks" }],
  },
  {
    key: "salesMonthEnd",
    label: "Sales Targets month-end",
    description:
      "Run (or re-run) the month-end calculation on Sales Targets: locks each customer's Recovery and OverDue for the month. Everyone else sees the page but not the button.",
    permission: "salesTarget.monthEnd",
    page: "/accounting/forms/salesTargets",
    // The page is everyone's (targets, MIS figures); only the action is gated.
    gatesPage: false,
    rights: [],
  },
];

/** Every permission code that opens an approval page (the main + extra rights). */
export const approvalCodes = (a) => [a.permission, ...(a.rights || []).map((r) => r.code)];

/** The approval a page belongs to, or undefined. */
export const approvalForPath = (path) =>
  APPROVALS.find((a) => a.gatesPage !== false && (path === a.page || String(path || "").startsWith(`${a.page}/`)));
