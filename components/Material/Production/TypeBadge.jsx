// components/Material/Production/TypeBadge.jsx — production type chip.
import { cn } from "@/lib/utils";

const TYPE_CONFIG = {
  new: { className: "border-primary/25 text-primary", label: "New Production" },
  sf: { className: "border-border text-foreground", label: "SF to FG" },
  reprocessing: { className: "border-dashed border-primary/40 text-primary", label: "Reprocessing" },
  default: { className: "border-border text-muted-foreground", label: "Unknown" },
};

const TypeBadge = ({ type }) => {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.default;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border bg-background px-2 py-0.5 text-[11.5px] font-medium",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
};

export default TypeBadge;
