"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UserCheck,
  UserX,
  Search,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  ShieldOff,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoles } from "@/hooks/useRoles";
import { roleLabel } from "@/lib/auth/roleNames";
import EmployeeFormModal from "./EmployeeFormModal";
import EmployeeProfileSheet from "@/components/HR/EmployeeProfileSheet";
import { useEmployeeLookups } from "./useEmployeeLookups";

const PAGE_SIZE = 15;


const apiError = (err, fallback) =>
  err?.response?.data?.error || err?.response?.data?.message || err?.message || fallback;

const fullName = (e) => [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ");

function Avatar({ emp, size = "h-10 w-10" }) {
  const initials = [emp.firstName, emp.surname]
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-sm font-bold text-primary",
        size
      )}
    >
      {emp.photographUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={emp.photographUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initials || "?"
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold",
        active
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700/50 dark:text-zinc-300"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-zinc-500")} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function LoginBadge({ user }) {
  if (!user) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <ShieldOff className="h-3.5 w-3.5" /> No login
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        <ShieldCheck className={cn("h-4 w-4 shrink-0", user.isActive ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
        <span className="truncate font-mono">{user.username || user.email}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {roleLabel(user.role)}
        {!user.isActive && <span className="ml-1 font-semibold text-destructive">· disabled</span>}
      </span>
    </div>
  );
}

function StatChip({ icon: Icon, label, value, active, onClick, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center gap-3 rounded-xl border bg-card p-3 text-left transition-all sm:p-4",
        active ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/40"
      )}
    >
      <div className={cn("rounded-lg p-2", tone)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-extrabold leading-none tabular-nums sm:text-2xl">{value}</p>
        <p className="mt-1 truncate text-xs font-semibold text-muted-foreground sm:text-sm">{label}</p>
      </div>
    </button>
  );
}

function pageWindow(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(`gap-${n}`);
    out.push(n);
  });
  return out;
}

export default function EmployeeSetup() {
  const queryClient = useQueryClient();
  // Giving / changing logins: employee.manage (Admin → Roles).
  const { can } = usePermissions();
  useRoles(); // role names for the login column
  const canAdminAccess = can("employee.manage");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [loginFilter, setLoginFilter] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [formError, setFormError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // Row click → the HR profile (attendance, leave, pay …); Edit from there or the pencil.
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: lookups } = useEmployeeLookups(true);

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ["employees", page, debouncedSearch, statusFilter, departmentFilter, loginFilter],
    queryFn: async () => {
      const res = await axios.get("/api/employees", {
        params: {
          page,
          limit: PAGE_SIZE,
          search: debouncedSearch || undefined,
          status: statusFilter,
          departmentId: departmentFilter,
          hasLogin: loginFilter,
        },
      });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });

  const employees = data?.data || [];
  const pagination = data?.pagination;
  const summary = data?.summary || { total: 0, active: 0, inactive: 0 };
  const filtersActive =
    !!debouncedSearch || statusFilter !== "all" || departmentFilter !== "all" || loginFilter !== "all";

  const closeModal = () => {
    setModalOpen(false);
    setEditingEmployee(null);
    setFormError(null);
  };

  const saveMutation = useMutation({
    mutationFn: async ({ id, payload }) =>
      id ? (await axios.put(`/api/employees/${id}`, payload)).data : (await axios.post("/api/employees", payload)).data,
    onSuccess: (saved, { id, meta }) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      const name = `${saved.firstName} ${saved.surname}`;
      const extras = [];
      if (meta?.loginCreated) extras.push(`login "${saved.user?.username || ""}" created`);
      else if (meta?.passwordChanged) extras.push("password changed");
      toast.success(id ? `Saved ${name}` : `Added ${name} (#${saved.id})`, {
        description: extras.length ? extras.join(" · ") : undefined,
      });
      closeModal();
    },
    onError: (err) => {
      const msg = apiError(err, "Failed to save employee");
      setFormError(msg);
      toast.error(msg, { duration: 6000 });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => (await axios.delete(`/api/employees/${id}`)).data,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(res?.message || "Employee deleted");
      setDeleting(null);
    },
    onError: (err) => {
      toast.error(apiError(err, "Failed to delete employee"), { duration: 7000 });
      setDeleting(null);
    },
  });

  const openCreate = () => {
    setEditingEmployee(null);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (emp) => {
    setEditingEmployee(emp);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = (payload, meta) => {
    setFormError(null);
    saveMutation.mutate({ id: editingEmployee?.id, payload, meta });
  };

  const resetFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setDepartmentFilter("all");
    setLoginFilter("all");
    setPage(1);
  };

  const pages = pagination?.pages || 1;
  const pageItems = useMemo(() => pageWindow(pagination?.page || 1, pages), [pagination?.page, pages]);

  const rowActions = (emp) => (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" onClick={() => openEdit(emp)} title="Edit" aria-label={`Edit ${fullName(emp)}`}>
        <Pencil className="h-4 w-4" />
      </Button>
      {canAdminAccess && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDeleting(emp)}
          title="Delete"
          aria-label={`Delete ${fullName(emp)}`}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Employees</h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Employee records, payroll details and system logins.
            </p>
          </div>
          <Button onClick={openCreate} size="lg" className="w-full gap-2 font-semibold sm:w-auto">
            <Plus className="h-5 w-5" />
            Add employee
          </Button>
        </div>

        {/* Stats double as quick status filters */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <StatChip
            icon={Users}
            label="All employees"
            value={summary.total}
            active={statusFilter === "all"}
            onClick={() => { setStatusFilter("all"); setPage(1); }}
            tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
          />
          <StatChip
            icon={UserCheck}
            label="Active"
            value={summary.active}
            active={statusFilter === "ACTIVE"}
            onClick={() => { setStatusFilter("ACTIVE"); setPage(1); }}
            tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          />
          <StatChip
            icon={UserX}
            label="Inactive"
            value={summary.inactive}
            active={statusFilter === "INACTIVE"}
            onClick={() => { setStatusFilter("INACTIVE"); setPage(1); }}
            tone="bg-zinc-200 text-zinc-700 dark:bg-zinc-700/50 dark:text-zinc-300"
          />
        </div>

        {/* Toolbar */}
        <div className="rounded-xl border bg-card p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, ID, phone, CNIC, email or username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-9 pr-9"
                aria-label="Search employees"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="h-10 lg:w-36" aria-label="Status filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Select value={loginFilter} onValueChange={(v) => { setLoginFilter(v); setPage(1); }}>
                <SelectTrigger className="h-10 lg:w-36" aria-label="Login filter">
                  <SelectValue placeholder="Login" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any login</SelectItem>
                  <SelectItem value="yes">Has login</SelectItem>
                  <SelectItem value="no">No login</SelectItem>
                </SelectContent>
              </Select>
              <Select value={departmentFilter} onValueChange={(v) => { setDepartmentFilter(v); setPage(1); }}>
                <SelectTrigger className="col-span-2 h-10 sm:col-span-1 lg:w-52" aria-label="Department filter">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All departments</SelectItem>
                  {(lookups?.departments || []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.dept_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {filtersActive && (
            <div className="mt-3 flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {pagination ? `${pagination.total} match${pagination.total === 1 ? "" : "es"}` : "Filtering…"}
              </span>
              <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1">
                <X className="h-4 w-4" /> Clear filters
              </Button>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="relative overflow-hidden rounded-xl border bg-card">
          {isFetching && !isLoading && (
            <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-primary" aria-hidden />
          )}

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading employees…
            </div>
          ) : isError ? (
            <div className="p-6 text-sm font-medium text-destructive">
              Failed to load employees: {apiError(error, "unknown error")}
            </div>
          ) : employees.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <div className="rounded-full bg-muted p-3">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-base font-bold">{filtersActive ? "No employees match these filters" : "No employees yet"}</p>
              {filtersActive ? (
                <Button variant="outline" size="sm" onClick={resetFilters}>Clear filters</Button>
              ) : (
                <Button size="sm" onClick={openCreate} className="gap-1"><Plus className="h-4 w-4" /> Add the first employee</Button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold">Employee</th>
                      <th className="px-4 py-3 text-left font-bold">Emp no</th>
                      <th className="px-4 py-3 text-left font-bold">Department / designation</th>
                      <th className="px-4 py-3 text-left font-bold">Status</th>
                      <th className="px-4 py-3 text-left font-bold">System login</th>
                      <th className="px-4 py-3 text-right font-bold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {employees.map((emp) => (
                      <tr
                        key={emp.id}
                        className="cursor-pointer transition-colors hover:bg-muted/40"
                        onClick={(e) => {
                          if (e.target.closest("button")) return;
                          setViewing(emp);
                        }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar emp={emp} />
                            <div className="min-w-0">
                              <p className="truncate font-bold text-foreground">{fullName(emp)}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {emp.phoneNumber || emp.emailAddress}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold tabular-nums">{emp.id}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{emp.department?.dept_name || "—"}</p>
                          <p className="text-xs text-muted-foreground">{emp.Designation?.desg_name || "—"}</p>
                        </td>
                        <td className="px-4 py-3"><StatusPill status={emp.status} /></td>
                        <td className="max-w-[14rem] px-4 py-3"><LoginBadge user={emp.user} /></td>
                        <td className="px-4 py-3">{rowActions(emp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="divide-y md:hidden">
                {employees.map((emp) => (
                  <li key={emp.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar emp={emp} size="h-11 w-11" />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setViewing(emp)}>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="truncate text-base font-bold">{fullName(emp)}</p>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">#{emp.id}</span>
                        </div>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          {[emp.department?.dept_name, emp.Designation?.desg_name].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </button>
                      {rowActions(emp)}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pl-14">
                      <StatusPill status={emp.status} />
                      <LoginBadge user={emp.user} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {pagination && pagination.total > 0 && (
            <div className="flex flex-col items-center gap-3 border-t p-3 sm:flex-row sm:justify-between sm:p-4">
              <span className="text-sm text-muted-foreground">
                Showing <b className="text-foreground">{(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)}</b> of{" "}
                <b className="text-foreground">{pagination.total}</b>
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pageItems.map((n) =>
                  typeof n === "string" ? (
                    <span key={n} className="px-1 text-muted-foreground">…</span>
                  ) : (
                    <Button
                      key={n}
                      variant={n === pagination.page ? "default" : "outline"}
                      size="sm"
                      className="h-9 min-w-9 px-2 font-semibold"
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </Button>
                  )
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {viewing && (
        <EmployeeProfileSheet
          key={viewing.id}
          employee={viewing}
          onClose={() => setViewing(null)}
          onEdit={(emp) => {
            setViewing(null);
            openEdit(emp);
          }}
        />
      )}

      <EmployeeFormModal
        open={modalOpen}
        onClose={closeModal}
        employee={editingEmployee}
        onSubmit={handleSubmit}
        isSubmitting={saveMutation.isPending}
        serverError={formError}
        canAdministerAccess={canAdminAccess}
        onDocumentsChange={() => queryClient.invalidateQueries({ queryKey: ["employees"] })}
      />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && !deleteMutation.isPending && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting ? fullName(deleting) : "employee"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Employee #{deleting?.id} will be removed permanently.
              {deleting?.user && " Their system login will be deactivated."} If the employee has left, consider
              setting the status to Inactive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate(deleting.id);
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
