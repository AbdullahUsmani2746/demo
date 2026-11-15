// Sale Order approvals live in the Approvals inbox now, beside every other
// request (lib/approvals/saleOrders.js). Old links and menus land there,
// filtered to Sale Orders; the inbox shows each person only their own share.
import { redirect } from "next/navigation";

export default function SaleOrderApprovalsPage() {
  redirect("/dashboard/approvals?type=saleOrder");
}
