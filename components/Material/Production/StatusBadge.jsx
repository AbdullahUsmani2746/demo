// components/Material/Production/StatusBadge.jsx — process order status chip.
// Each status keeps its own tone so the lifecycle reads at a glance:
// Scheduled (muted) → Completed / ready to send (brand) → In Progress (warn)
// → Posted (ok); Cancelled (bad).
import { Chip } from "@/components/Material/shared/LabUI";

export const STATUS_TONE = {
  Scheduled: "muted",
  Completed: "brand",
  COMPLETED: "brand",
  "In Progress": "warn",
  Posted: "ok",
  Cancelled: "bad",
};

const StatusBadge = ({ status, className }) => (
  <Chip tone={STATUS_TONE[status] || "muted"} className={className}>
    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
    {status || "—"}
  </Chip>
);

export default StatusBadge;
