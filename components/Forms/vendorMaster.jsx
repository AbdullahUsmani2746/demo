'use client';

// Accounts → Vendors: the vendor accounts (the "vendors" account group,
// Finance → Account Settings) with their contact details. Saves through
// PUT /api/forms/vendors (setup.vendors.manage), which takes contact fields only.
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Edit3, Search, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { HR_MAIN, HR_PAGE, PageHeader, Panel, EmptyState, ListSkeleton, TH, TH_ROW, CODE_CHIP } from '@/components/HR/shared';

const PAGE_SIZE = 10;

const FIELDS = [
  ['acname', 'Name'],
  ['address', 'Address'],
  ['area', 'Area'],
  ['city', 'City'],
  ['phoneFax', 'Phone / Fax'],
  ['email', 'Email'],
  ['category', 'Category'],
  ['contactPerson', 'Contact person'],
  ['ntnNo', 'NTN'],
];

// Outside the page component, so typing does not remount the inputs.
function VendorForm({ form, setForm }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label>Code</Label>
        <Input value={form.acno ?? ''} disabled />
      </div>
      {FIELDS.map(([k, label]) => (
        <div key={k} className="space-y-1">
          <Label>{label}</Label>
          <Input value={form[k] ?? ''} onChange={set(k)} />
        </div>
      ))}
    </div>
  );
}

export default function VendorMaster() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ vendors: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), search });
      const res = await fetch(`/api/forms/vendors?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Could not load vendors.');
      setData({ vendors: json.vendors || [], total: json.total || 0 });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/forms/vendors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Could not save the vendor.');
      toast.success('Vendor saved.');
      setForm(null);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const open = (v) => setForm({ ...v });

  return (
    <div className={HR_PAGE}>
      <PageHeader icon={Truck} title="Vendors" subtitle="Supplier accounts and their contact details" badge={data.total || undefined} />
      <main className={HR_MAIN}>
        <Panel
          title="Vendors"
          actions={
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, code, city…" className="pl-9" />
            </div>
          }
          bodyClassName="p-0"
        >
          {loading ? (
            <ListSkeleton rows={6} className="p-4" />
          ) : data.vendors.length === 0 ? (
            <EmptyState icon={Truck} title="No vendors" hint={search ? 'Nothing matches the search.' : 'Vendor accounts are added in the chart of accounts.'} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      {['Code', 'Name', 'City', 'Email', 'Category', ''].map((h) => <th key={h} className={TH}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.vendors.map((v) => (
                      <tr key={v.acno} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-3 py-2"><span className={CODE_CHIP}>{v.acno}</span></td>
                        <td className="px-3 py-2 font-medium">{v.acname}</td>
                        <td className="px-3 py-2">{v.city || '—'}</td>
                        <td className="px-3 py-2">{v.email || '—'}</td>
                        <td className="px-3 py-2">{v.category || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <Button variant="outline" size="sm" onClick={() => open(v)}><Edit3 className="mr-1 h-4 w-4" /> Edit</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y md:hidden">
                {data.vendors.map((v) => (
                  <li key={v.acno} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className={CODE_CHIP}>{v.acno}</span><span className="truncate font-medium">{v.acname}</span></div>
                      <div className="mt-1 text-xs text-muted-foreground">{[v.city, v.category, v.email].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                    <Button variant="outline" size="icon" className="shrink-0" onClick={() => open(v)} title="Edit"><Edit3 className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex items-center justify-between gap-2 border-t p-3 text-sm">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page === 1}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-muted-foreground">Page {page} of {pages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </Panel>
      </main>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit vendor</DialogTitle>
          </DialogHeader>
          {form && <VendorForm form={form} setForm={setForm} />}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
