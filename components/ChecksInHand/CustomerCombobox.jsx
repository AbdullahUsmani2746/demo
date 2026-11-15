"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Check, ChevronsUpDown, User2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/Material/shared/LabUI";

/**
 * Customer picker for the cheque form and list filters.
 *
 * Reads /api/accounts/checks-in-hand/customers, which returns BOTH books —
 * official (ACNO.isActive = true) and unofficial (false) — because a cheque exists
 * whichever book its customer sits in. Each row is badged with its book so
 * the difference stays visible while picking.
 *
 * Props:
 *   value       - selected acno (number | "" )
 *   onChange    - (acno: number | "", customer | null) => void
 *   allowAll    - show an "All Customers" entry (list/report filters)
 *   category    - "all" | "active" | "inactive" — restricts the list
 */
export default function CustomerCombobox({
  value,
  onChange,
  allowAll = false,
  category = "all",
  disabled = false,
  placeholder = "Select customer…",
  id,
  className,
}) {
  const [open, setOpen] = useState(false);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["checks-in-hand", "customers", category],
    queryFn: async () => {
      const res = await axios.get("/api/accounts/checks-in-hand/customers", {
        params: { category },
      });
      return res.data?.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const selected = customers.find((c) => String(c.acno) === String(value));

  const label = value === "" || value == null
    ? allowAll
      ? "All Customers"
      : placeholder
    : selected
    ? `${selected.acno} - ${selected.acname}`
    : `#${value}`;

  const pick = (customer) => {
    onChange(customer ? customer.acno : "", customer ?? null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-10",
            value === "" && !allowAll && "text-muted-foreground",
            className
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <User2 className="h-4 w-4 shrink-0 opacity-50" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[min(340px,calc(100vw-1.5rem))] p-0" align="start">
        <Command
          // cmdk's default filter only matches the `value` string; customers
          // need to be findable by code, name and sales person at once, so
          // match against a composite haystack instead.
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Search by code, name or sales person…" />
          <CommandList className="max-h-[320px]">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading customers…
              </div>
            ) : (
              <CommandEmpty>No customer found.</CommandEmpty>
            )}

            {allowAll && (
              <CommandGroup>
                <CommandItem value="all customers" onSelect={() => pick(null)}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === "" || value == null ? "opacity-100" : "opacity-0"
                    )}
                  />
                  All Customers
                </CommandItem>
              </CommandGroup>
            )}

            {customers.length > 0 && (
              <CommandGroup heading={`${customers.length} customers`}>
                {customers.map((c) => (
                  <CommandItem
                    key={c.acno}
                    value={`${c.acno} ${c.acname} ${c.salesPersonName}`}
                    onSelect={() => pick(c)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        String(c.acno) === String(value) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm">
                        <span className="text-muted-foreground tabular-nums mr-2">
                          {c.acno}
                        </span>
                        {c.acname}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {c.salesPersonName}
                      </div>
                    </div>
                    <Chip tone={c.isActive ? "ok" : "warn"} className="ml-2 shrink-0 text-[10px]">
                      {c.category}
                    </Chip>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
