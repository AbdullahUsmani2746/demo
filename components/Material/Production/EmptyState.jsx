"use client";
import React from "react";
import { Plus } from "lucide-react";
import { LabEmpty } from "@/components/Material/shared/LabUI";

const EmptyState = ({
  icon,
  title = "No Data Found",
  description = "There is no data available right now.",
  action,
}) => (
  <LabEmpty
    icon={icon}
    title={title}
    hint={description}
    action={
      action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {action.label}
        </button>
      ) : null
    }
  />
);

export default EmptyState;
