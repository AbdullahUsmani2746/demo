"use client";
// Finance → Sub Accounts — names kept under an account (model subAccount) for
// the "Sub Account" field on receipt / payment / journal lines. Feature
// "vouchers.subAccounts" (lib/vouchers/subAccounts.js, app/api/sub-accounts).
// A sub account already used on a voucher keeps its name (lines store it).
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncSelect from "react-select/async";
import { toast } from "sonner";
import { Check, Layers, Lock, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchableSelectStyles } from "@/components/ui/searchable-select";
import { useFeatures } from "@/hooks/useFeatures";
import {
  HR_PAGE, HR_MAIN, PageHeader, Panel, EmptyState, ListSkeleton, CODE_CHIP, CHIP, TH_ROW, TH, api,
} from "@/components/HR/shared";

const FEATURE = "vouchers.subAccounts";

async function loadAccounts(input) {
  const q = input?.trim() ? `?search=${encodeURIComponent(input.trim())}` : "";
  const res = await api(`/api/accounts/acno${q}`);
  return (res.data || []).slice(0, 50).map((a) => ({ value: a.acno, label: `${a.acno} - ${a.acname}` }));
}

function NameEditor({ initial, onSave, onCancel, busy }) {
  const [text, setText] = useState(initial);
  return (
    <form
      className="flex w-full items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text);
      }}
    >
      <Input autoFocus value={text} onChange={(e) => setText(e.target.value.toUpperCase())} className="h-8 min-w-0 flex-1" maxLength={250} />
      <Button type="submit" size="icon" className="h-8 w-8 shrink-0" disabled={busy || !text.trim()} title="Save">
        <Check className="h-4 w-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onCancel} title="Cancel">
        <X className="h-4 w-4" />
      </Button>
    </form>
  );
}

export default function SubAccountsPage() {
  const features = useFeatures();
  const enabled = features.on(FEATURE);
  const qc = useQueryClient();
  const [account, setAccount] = useState(null);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["sub-accounts-list"],
    queryFn: () => api("/api/sub-accounts/list"),
    enabled: enabled,
  });
  const rows = data?.data || [];
  const canManage = Boolean(data?.canManage);
  const refresh = () => qc.invalidateQueries({ queryKey: ["sub-accounts-list"] });

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!account || r.acno === account.value) &&
        (!t || `${r.acname} ${r.acno} ${r.account_name}`.toLowerCase().includes(t)),
    );
  }, [rows, account, q]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const r of shown) {
      if (!m.has(r.acno)) m.set(r.acno, { acno: r.acno, name: r.account_name, items: [] });
      m.get(r.acno).items.push(r);
    }
    return [...m.values()];
  }, [shown]);

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res?.message || ok);
      refresh();
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!account || !name.trim()) return;
    const done = await run(() => api("/api/sub-accounts", { method: "POST", body: { acno: account.value, acname: name } }), `Added "${name.trim().toUpperCase()}"`);
    if (done) setName("");
  };
  const rename = (r, text) =>
    run(() => api("/api/sub-accounts", { method: "PUT", body: { id: r.id, acname: text } }), "Renamed").then((ok) => ok && setEditing(null));
  const remove = (r) => {
    if (!window.confirm(`Delete sub account "${r.acname}" of ${r.acno} - ${r.account_name}?`)) return;
    run(() => api(`/api/sub-accounts?id=${r.id}`, { method: "DELETE" }), "Deleted");
  };

  if (!features.isLoading && !enabled) {
    return (
      <div className={HR_PAGE}>
        <PageHeader icon={Layers} title="Sub Accounts" />
        <main className={HR_MAIN}>
          <Panel>
            <EmptyState
              icon={Lock}
              title="Sub Accounts are switched off"
              hint="Turn on “Sub Accounts on voucher lines” in Settings → Features to use them."
            />
          </Panel>
        </main>
      </div>
    );
  }

  const actionsFor = (r) =>
    canManage && (
      <div className="flex shrink-0 items-center gap-1">
        {r.lines > 0 ? (
          <span className="text-[11px] text-muted-foreground" title="Used on vouchers — the name stays as it is">in use</span>
        ) : (
          <>
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Rename" onClick={() => setEditing(r.id)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-red-700 hover:text-red-800" title="Delete" onClick={() => remove(r)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    );

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={Layers}
        title="Sub Accounts"
        badge={rows.length || undefined}
        subtitle="Names kept under an account (e.g. FUEL under Vehicle Expenses), picked on receipt, payment and journal lines. Which accounts must name one: Account Settings → Accounts that need a Sub Account."
      />
      <main className={`${HR_MAIN} space-y-4`}>
        <Panel title="Add or find" icon={Plus} bodyClassName="p-3 sm:p-4">
          <form onSubmit={add} className="grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
            <AsyncSelect
              instanceId="sub-acc-account"
              cacheOptions
              defaultOptions
              loadOptions={loadAccounts}
              value={account}
              onChange={setAccount}
              isClearable
              placeholder="Account…"
              styles={searchableSelectStyles}
              menuPortalTarget={typeof window !== "undefined" ? document.body : null}
            />
            {canManage && (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase())}
                placeholder={account ? "New sub account name…" : "Pick the account first"}
                disabled={!account}
                maxLength={250}
                className="h-10"
              />
            )}
            {canManage && (
              <Button type="submit" className="h-10" disabled={busy || !account || !name.trim()}>
                <Plus className="mr-1.5 h-4 w-4" /> Add
              </Button>
            )}
          </form>
          <div className="mt-2 flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 md:max-w-sm">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sub accounts…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </div>
        </Panel>

        <Panel title="Sub accounts by account" icon={Layers}>
          {isLoading || features.isLoading ? (
            <ListSkeleton />
          ) : groups.length === 0 ? (
            <EmptyState icon={Layers} title="No sub accounts yet" hint={canManage ? "Pick an account above and add its first sub account — or use “Add new” on a voucher line." : "None have been added."} />
          ) : (
            <>
              {/* phone: cards */}
              <div className="divide-y divide-border md:hidden">
                {groups.map((g) => (
                  <div key={g.acno} className="px-3 py-3">
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <span className={CODE_CHIP}>{g.acno}</span>
                      <span className="min-w-0 truncate">{g.name}</span>
                    </p>
                    <ul className="space-y-1.5">
                      {g.items.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                          {editing === r.id ? (
                            <NameEditor initial={r.acname} busy={busy} onSave={(t) => rename(r, t)} onCancel={() => setEditing(null)} />
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.acname}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${r.lines ? CHIP.brand : CHIP.muted}`}>{r.lines} lines</span>
                              {actionsFor(r)}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {/* desktop: table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      <th className={TH}>Account</th>
                      <th className={TH}>Sub Account</th>
                      <th className={`${TH} text-right`}>Voucher lines</th>
                      <th className={`${TH} w-32`} />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.flatMap((g) =>
                      g.items.map((r, i) => (
                        <tr key={r.id} className="border-b border-border/70 hover:bg-muted/40">
                          <td className="px-3 py-2 align-top">
                            {i === 0 && (
                              <span className="flex items-center gap-2">
                                <span className={CODE_CHIP}>{g.acno}</span>
                                <span className="font-medium">{g.name}</span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {editing === r.id ? (
                              <NameEditor initial={r.acname} busy={busy} onSave={(t) => rename(r, t)} onCancel={() => setEditing(null)} />
                            ) : (
                              <span className="font-medium">{r.acname}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.lines}</td>
                          <td className="px-3 py-2 text-right">{editing === r.id ? null : actionsFor(r)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </main>
    </div>
  );
}
