// components/approvals/NotAllowed.jsx — shown instead of an approval page to
// someone who is not one of its approvers (Admin → Permissions → Approvals).
import { ShieldAlert } from "lucide-react";

export default function NotAllowed({ title = "Approvals" }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-destructive/10 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only the people chosen as approvers can open this page. An administrator can add you on
          <b> Admin → Permissions → Approvals</b>.
        </p>
      </div>
    </div>
  );
}
