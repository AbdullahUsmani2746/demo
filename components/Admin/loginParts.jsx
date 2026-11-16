"use client";

// components/Admin/loginParts.jsx — pieces shared by the Employee screen's
// "Login & Roles" and Admin → Logins & Roles: the role picker (one main role +
// any number of extra roles, from the catalogue — hooks/useRoles.js), the
// password generator and the "shown once" password dialog.
// The server decides what may be given (lib/auth/roleAssign.js); the picker
// only hides what this person may not give.
import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CHIP } from "@/components/HR/shared";

/** A readable random password: no look-alike characters, 12 long. */
export function generatePassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const digits = "23456789";
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  let out = Array.from(buf, (n) => chars[n % chars.length]).join("");
  if (!/\d/.test(out)) out = out.slice(0, -1) + digits[buf[0] % digits.length];
  return out;
}

/**
 * Which roles this person may offer. `manageAll` = holds users.manage;
 * otherwise only the given levels (staff / self-service). Super Admin only for
 * a Super Admin. Roles the login already has always stay visible.
 */
export function offerableRoles(catalogue, { manageAll, levels, superAdmin, keep = [] }) {
  return catalogue.filter(
    (r) =>
      keep.includes(r.code) ||
      (r.super_admin ? superAdmin : manageAll || !levels || levels.includes(r.level)),
  );
}

/** Role chips for a list of codes (main role first, maroon). */
export function RoleChips({ roles = [], roleName, max = 4 }) {
  if (!roles.length) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = roles.slice(0, max);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((c, i) => (
        <span
          key={c}
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
            i === 0 ? "bg-primary text-primary-foreground" : CHIP.brand,
          )}
          title={i === 0 ? "Main role" : "Also holds"}
        >
          {roleName(c)}
        </span>
      ))}
      {roles.length > max && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", CHIP.muted)}>+{roles.length - max}</span>}
    </span>
  );
}

/**
 * Main role (select) + extra roles (toggle chips — Tab / Space friendly).
 * value = { role, roles } (roles = extra roles, never the main one).
 */
export function RolePicker({ options, role, roles = [], onChange, disabled, idPrefix = "rp" }) {
  const extras = options.filter((r) => r.code !== role);
  const toggle = (code) => {
    const next = roles.includes(code) ? roles.filter((c) => c !== code) : [...roles, code];
    onChange({ role, roles: next });
  };
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-main`} className="mb-1.5 block text-sm font-medium">
          Main role <span className="text-red-600">*</span>
        </label>
        <select
          id={`${idPrefix}-main`}
          value={role || ""}
          disabled={disabled}
          onChange={(e) => onChange({ role: e.target.value, roles: roles.filter((c) => c !== e.target.value) })}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-50"
        >
          <option value="" disabled>
            Pick a role…
          </option>
          {options.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Decides the sidebar and the home screen.</p>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">
          Also holds <span className="font-normal text-muted-foreground">({roles.length} extra)</span>
        </p>
        {extras.length === 0 ? (
          <p className="text-xs text-muted-foreground">No other roles you may give.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Extra roles">
            {extras.map((r) => {
              const on = roles.includes(r.code);
              return (
                <button
                  key={r.code}
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => toggle(r.code)}
                  title={r.description || r.name}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5",
                  )}
                >
                  {on && <Check className="h-3 w-3" />}
                  {r.name}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">The person may do everything any of their roles allows.</p>
      </div>
    </div>
  );
}

/** The new password, shown once after a save, with Copy. */
export function PasswordOnceDialog({ password, who, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast.success("Password copied");
    } catch {
      toast.error("Could not copy — select the text and copy it");
    }
  };
  return (
    <Dialog open={!!password} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" /> New password
          </DialogTitle>
          <DialogDescription>
            {who ? <>For <span className="font-semibold text-foreground">{who}</span>. </> : null}
            It is shown only now — give it to the person; they can change it after signing in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
          <code className="min-w-0 flex-1 select-all break-all font-mono text-lg font-bold tracking-wide text-primary">{password}</code>
          <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
