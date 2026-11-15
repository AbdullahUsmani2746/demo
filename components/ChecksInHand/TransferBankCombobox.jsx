"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
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
import { TRANSFER_BANK_GROUP } from "@/lib/accounts/checksInHand";

/**
 * "Transfer To Bank" picker — OUR bank/cash ledger the cheque is deposited
 * into, as opposed to BankCombobox which is the customer's drawn-on bank
 * (free text, printed on the cheque itself).
 *
 * Sourced from the real chart of accounts: /api/accounts/acno restricted to
 * the bank/cash groups (MACNO 21, 32, 65, 85), so the deposit lands on an
 * account that actually exists in the ledger.
 *
 * Props:
 *   value     - selected acno (number | "")
 *   onChange  - (acno: number | "", account | null) => void
 *   allowAll  - show an "All banks" entry (list/report filters)
 */
export default function TransferBankCombobox({
  value,
  onChange,
  allowAll = false,
  disabled = false,
  placeholder = "Select bank…",
  id,
  className,
}) {
  const [open, setOpen] = useState(false);

  const { data: banks = [], isLoading } = useQuery({
    queryKey: ["accounts", "transfer-banks", TRANSFER_BANK_GROUP],
    queryFn: async () => {
      const res = await axios.get("/api/accounts/acno", {
        params: { group: TRANSFER_BANK_GROUP },
      });
      const rows = res.data?.data ?? [];
      return [...rows].sort((a, b) =>
        String(a.acname ?? "").localeCompare(String(b.acname ?? ""))
      );
    },
    staleTime: 5 * 60_000,
  });

  const selected = banks.find((b) => String(b.acno) === String(value));

  const label =
    value === "" || value == null
      ? allowAll
        ? "All banks"
        : placeholder
      : selected
      ? `${selected.acno} - ${selected.acname}`
      : `#${value}`;

  const pick = (account) => {
    onChange(account ? account.acno : "", account ?? null);
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
            (value === "" || value == null) && !allowAll && "text-muted-foreground",
            className
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <Building2 className="h-4 w-4 shrink-0 opacity-50" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[min(320px,calc(100vw-1.5rem))] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search bank by code or name…" />
          <CommandList className="max-h-[300px]">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading banks…
              </div>
            ) : (
              <CommandEmpty>No bank account found.</CommandEmpty>
            )}

            {(allowAll || value) && (
              <CommandGroup>
                <CommandItem value="all banks none" onSelect={() => pick(null)}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === "" || value == null ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {allowAll ? "All banks" : "No bank / not transferred yet"}
                </CommandItem>
              </CommandGroup>
            )}

            {banks.length > 0 && (
              <CommandGroup heading={`${banks.length} bank accounts`}>
                {banks.map((b) => (
                  <CommandItem
                    key={b.acno}
                    value={`${b.acno} ${b.acname} ${b.bankAccountNo ?? ""}`}
                    onSelect={() => pick(b)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        String(b.acno) === String(value) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm">
                        <span className="text-muted-foreground tabular-nums mr-2">
                          {b.acno}
                        </span>
                        {b.acname}
                      </div>
                      {b.bankAccountNo && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          A/C {b.bankAccountNo}
                        </div>
                      )}
                    </div>
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
