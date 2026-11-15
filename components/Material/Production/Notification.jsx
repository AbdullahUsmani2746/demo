// components/Material/Production/Notification.jsx — inline toast (the list
// itself uses sonner; kept for anything that still renders it).
import { Check, AlertCircle, X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { CHIP } from "@/components/Material/shared/LabUI";

const TYPE_CONFIG = {
  success: { tone: CHIP.ok, icon: Check },
  error: { tone: CHIP.bad, icon: AlertCircle },
  warning: { tone: CHIP.warn, icon: AlertCircle },
};

const Notification = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const config = TYPE_CONFIG[type] || TYPE_CONFIG.success;

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      className="fixed right-3 top-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-lg animate-in slide-in-from-right-8 duration-300 sm:right-6 sm:top-6"
    >
      <span className={cn("flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg", config.tone)}>
        <config.icon size={16} />
      </span>
      <span className="text-sm font-medium text-foreground">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default Notification;
