import React from "react";
import { cn } from "@/lib/utils";

// A chart may ask for more room with `gridClassName` (e.g. "lg:col-span-2");
// it is put on the grid cell, where a span actually takes effect.
export default function DashboardGrid({
  children,
  className,
  columnsClassName = "grid-cols-1 lg:grid-cols-2",
  gapClassName = "gap-4",
}) {
  return (
    <div className={cn("grid items-stretch", columnsClassName, gapClassName, className)}>
      {React.Children.map(children, (child, idx) =>
        child ? (
          <div key={idx} className={cn("h-full min-w-0", child.props?.gridClassName)}>
            {child}
          </div>
        ) : null
      )}
    </div>
  );
}
