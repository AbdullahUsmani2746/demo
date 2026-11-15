"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Check, ChevronsUpDown, Plus, Landmark } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { normalizeBank } from "@/lib/accounts/checksInHand";

/**
 * Bank picker for the cheque form.
 *
 * There is no bank master — the first time a bank is needed the user types it,
 * and from then on it appears in this dropdown, ordered by how often it has
 * been used. Whatever route it comes in by (typed or picked) the value is
 * normalised to UPPERCASE with collapsed spaces, so "Meezan", "MEEZAN " and
 * "meezan" can never become three separate entries in the list.
 *
 * Props:
 *   value     - current bank string
 *   onChange  - (normalisedBank: string) => void
 */
export default function BankCombobox({
  value,
  onChange,
  disabled = false,
  placeholder = "Select or type a bank…",
  id,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: banks = [], isLoading } = useQuery({
    queryKey: ["checks-in-hand", "banks"],
    queryFn: async () => {
      const res = await axios.get("/api/accounts/checks-in-hand/banks");
      return res.data?.data ?? [];
    },
    staleTime: 60_000,
  });

  const typed = normalizeBank(query);

  // Offer "use what I typed" only when it is not already an exact entry.
  const canCreate = useMemo(
    () => typed.length > 0 && !banks.some((b) => b.value === typed),
    [typed, banks]
  );

  const commit = (bank) => {
    onChange(normalizeBank(bank));
    setQuery("");
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
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <Landmark className="h-4 w-4 shrink-0 opacity-50" />
            <span className="truncate">{value || placeholder}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Type a bank name…"
            value={query}
            onValueChange={setQuery}
            // Enter commits the typed value straight away, so entering a brand
            // new bank never needs a mouse.
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                commit(typed);
              }
            }}
          />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading banks…
              </div>
            ) : (
              <CommandEmpty>
                {typed ? (
                  <button
                    type="button"
                    onClick={() => commit(typed)}
                    className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded-sm flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add <span className="font-semibold">{typed}</span>
                  </button>
                ) : (
                  "No banks yet — start typing to add one."
                )}
              </CommandEmpty>
            )}

            {canCreate && banks.length > 0 && (
              <CommandGroup heading="New">
                <CommandItem value={`__create__${typed}`} onSelect={() => commit(typed)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add <span className="ml-1 font-semibold">{typed}</span>
                </CommandItem>
              </CommandGroup>
            )}

            {banks.length > 0 && (
              <CommandGroup heading="Used before">
                {banks.map((bank) => (
                  <CommandItem
                    key={bank.value}
                    value={bank.value}
                    onSelect={() => commit(bank.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === bank.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="flex-1 truncate">{bank.label}</span>
                    <Badge variant="secondary" className="ml-2 shrink-0 text-[10px]">
                      {bank.count}
                    </Badge>
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
