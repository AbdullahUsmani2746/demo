// Sale Return review — only reviewers (saleReturn.approve / saleReturn.remark,
// granted on Admin → Permissions → Approvals) may open it. Checked on the
// server; the API checks the same rights.
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canOpenApproval } from "@/lib/approvals/access";
import NotAllowed from "@/components/approvals/NotAllowed";
import SaleReturnApprovalsForm from "@/components/Forms/saleReturnApprovalsForm";

export default async function SaleReturnApprovalsPage() {
  const session = await getServerSession(authOptions);
  if (!(await canOpenApproval(session, "saleReturn"))) return <NotAllowed title="Sale Return review" />;
  return <SaleReturnApprovalsForm />;
}
