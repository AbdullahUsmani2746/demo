"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import axios from "axios";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Eye,
  EyeOff,
  Loader2,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  User,
  Briefcase,
  Wallet,
  Phone,
  FileText,
  AlertCircle,
  UserPlus,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmployeeLookups } from "./useEmployeeLookups";
import EmployeeDocumentsPanel from "./EmployeeDocumentsPanel";
import { BLOOD_GROUPS } from "@/validators/employee.validator";
import { useRoles } from "@/hooks/useRoles";
import { usePermissions } from "@/hooks/usePermissions";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Native inputs / cleared selects yield "" or null. z.coerce turns those into
// 0 or Invalid Date instead of "missing", so normalise them first.
const blank = (v) => (v === "" || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v);

const requiredId = (message) =>
  z.preprocess(blank, z.coerce.number({ required_error: message, invalid_type_error: message }).int().positive(message));
const optionalId = z.preprocess(blank, z.coerce.number().int().optional()).nullable();
const requiredDate = (message) =>
  z.preprocess(blank, z.coerce.date({ required_error: message, invalid_type_error: message }));
const optionalDate = z.preprocess(blank, z.coerce.date({ invalid_type_error: "Enter a valid date" }).optional()).nullable();

// Role names / options: the catalogue (Admin → Roles) — hooks/useRoles.js.

const baseFormSchema = z.object({
  // Pre-filled with the next available number but editable; fixed on edit.
  id: z.preprocess(blank, z.coerce.number({ invalid_type_error: "Employee ID must be a number" }).int().positive("Employee ID must be positive").optional()),
  firstName: z.string().trim().min(1, "First name is required").max(25, "Max 25 characters"),
  middleName: z.string().trim().max(25, "Max 25 characters").optional().nullable(),
  surname: z.string().trim().min(1, "Surname is required").max(25, "Max 25 characters"),
  dob: requiredDate("Date of birth is required").refine((d) => d <= new Date(), "Date of birth cannot be in the future"),
  gender: z.enum(["Male", "Female"], { required_error: "Gender is required" }),
  phoneNumber: z.string().trim().min(1, "Phone number is required").max(25, "Max 25 characters"),
  emailAddress: z.string().trim().min(1, "Email is required").email("Enter a valid email address").max(100),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  cnicNumber: z.string().trim().max(25, "Max 25 characters").optional().nullable(),
  dor: optionalDate,
  hireDate: requiredDate("Hire date is required"),

  designationId: requiredId("Designation is required"),
  departmentId: requiredId("Department is required"),
  workLocationId: optionalId,
  employeecatId: optionalId,
  employeetypeId: optionalId,
  cityId: optionalId,
  branchId: optionalId,
  managerId: optionalId,

  paymentMethod: z.enum(["CASH", "DIRECT_DEPOSIT", "CHEQUE"]),
  bankId: optionalId,
  bank_bracnhId: optionalId,
  accountName: z.string().trim().max(25, "Max 25 characters").optional().nullable(),
  accountNumber: z.string().trim().max(25, "Max 25 characters").optional().nullable(),
  payType: z.enum(["HOUR", "SALARY"]),
  rate: z.preprocess(
    blank,
    z.coerce.number({ required_error: "Rate is required", invalid_type_error: "Rate must be a number" }).min(0, "Rate cannot be negative")
  ),
  payFrequency: z.enum(["MONTHLY", "FORTNIGHTLY", "WEEKLY"]),
  costCenterId: requiredId("Cost center is required"),
  allowanceIds: z.array(z.number()).default([]),
  deductionIds: z.array(z.number()).default([]),
  leaveIds: z.array(z.number()).default([]),

  qualification: z.string().max(150, "Max 150 characters").optional().nullable(),
  emergencyContactName: z.string().max(100, "Max 100 characters").optional().nullable(),
  emergencyContactPhone: z.string().max(25, "Max 25 characters").optional().nullable(),
  residentialAddress: z.string().max(255, "Max 255 characters").optional().nullable(),
  bloodGroup: z.enum(BLOOD_GROUPS.map((b) => b.value)).optional().nullable(),
  nextOfKinName: z.string().max(100, "Max 100 characters").optional().nullable(),
  nextOfKinRelation: z.string().max(50, "Max 50 characters").optional().nullable(),
  nextOfKinPhone: z.string().max(25, "Max 25 characters").optional().nullable(),

  grantAccess: z.boolean().default(false),
  username: z
    .string()
    .trim()
    .max(25, "Username can be at most 25 characters")
    .refine((v) => !v.includes("@"), "Username cannot contain @")
    .optional()
    .nullable(),
  email: z.string().trim().email("Enter a valid login email").optional().or(z.literal("")),
  role: z.string().max(40).optional(),
  password: z.string().optional().or(z.literal("")),
  confirmPassword: z.string().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

// A new login needs a password; an existing one keeps its password unless a
// new one is typed (blank = unchanged). Either way a typed one must be >= 6
// characters and confirmed.
function buildFormSchema(hasExistingUser) {
  return baseFormSchema.superRefine((data, ctx) => {
    if (!data.grantAccess) return;
    if (!data.role) {
      ctx.addIssue({ path: ["role"], code: z.ZodIssueCode.custom, message: "Role is required" });
    }
    const pw = data.password || "";
    if (!hasExistingUser && !pw) {
      ctx.addIssue({ path: ["password"], code: z.ZodIssueCode.custom, message: "Password is required for a new login" });
    } else if (pw && pw.length < 6) {
      ctx.addIssue({ path: ["password"], code: z.ZodIssueCode.custom, message: "Password must be at least 6 characters" });
    }
    if (pw && pw !== (data.confirmPassword || "")) {
      ctx.addIssue({ path: ["confirmPassword"], code: z.ZodIssueCode.custom, message: "Passwords do not match" });
    }
  });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const SECTIONS = [
  { value: "personal", label: "Personal", icon: User, fields: ["id", "firstName", "middleName", "surname", "dob", "gender", "cnicNumber", "bloodGroup", "qualification", "status"] },
  { value: "job", label: "Job", icon: Briefcase, fields: ["departmentId", "designationId", "workLocationId", "branchId", "employeetypeId", "employeecatId", "managerId", "costCenterId", "hireDate", "dor"] },
  { value: "contact", label: "Contact", icon: Phone, fields: ["phoneNumber", "emailAddress", "cityId", "residentialAddress", "emergencyContactName", "emergencyContactPhone", "nextOfKinName", "nextOfKinRelation", "nextOfKinPhone"] },
  { value: "pay", label: "Pay & Bank", icon: Wallet, fields: ["paymentMethod", "payType", "payFrequency", "rate", "bankId", "bank_bracnhId", "accountName", "accountNumber"] },
  { value: "login", label: "System Login", icon: ShieldCheck, fields: ["username", "email", "role", "password", "confirmPassword"] },
  { value: "documents", label: "Documents", icon: FileText, fields: [] },
];

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function employeeToFormValues(employee) {
  const e = employee || {};
  const u = e.user || null;
  return {
    id: e.id ?? "",
    firstName: e.firstName || "",
    middleName: e.middleName || "",
    surname: e.surname || "",
    dob: toDateInput(e.dob),
    gender: e.gender === "Female" ? "Female" : "Male",
    phoneNumber: e.phoneNumber || "",
    emailAddress: e.emailAddress || "",
    status: e.status || "ACTIVE",
    cnicNumber: e.cnicNumber || "",
    dor: toDateInput(e.dor),
    hireDate: toDateInput(e.hireDate),
    designationId: e.designationId ?? null,
    departmentId: e.departmentId ?? null,
    workLocationId: e.workLocationId ?? null,
    employeecatId: e.employeecatId ?? null,
    employeetypeId: e.employeetypeId ?? null,
    cityId: e.cityId ?? null,
    branchId: e.branchId ?? null,
    managerId: e.managerId ?? null,
    paymentMethod: e.paymentMethod || "CASH",
    bankId: e.bankId ?? null,
    bank_bracnhId: e.bank_bracnhId ?? null,
    accountName: e.accountName || "",
    accountNumber: e.accountNumber || "",
    payType: e.payType || "SALARY",
    rate: e.rate ?? "",
    payFrequency: e.payFrequency || "MONTHLY",
    costCenterId: e.costCenterId ?? null,
    allowanceIds: (e.allowances || []).map((a) => a.id),
    deductionIds: (e.deductions || []).map((d) => d.id),
    leaveIds: (e.leaves || []).map((l) => l.id),
    qualification: e.qualification || "",
    emergencyContactName: e.emergencyContactName || "",
    emergencyContactPhone: e.emergencyContactPhone || "",
    residentialAddress: e.residentialAddress || "",
    bloodGroup: e.bloodGroup ?? null,
    nextOfKinName: e.nextOfKinName || "",
    nextOfKinRelation: e.nextOfKinRelation || "",
    nextOfKinPhone: e.nextOfKinPhone || "",
    grantAccess: !!u,
    username: u?.username || "",
    email: u?.email || e.emailAddress || "",
    role: u?.role || "EMPLOYEE",
    password: "",
    confirmPassword: "",
    isActive: u?.isActive ?? true,
  };
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Field({ label, required, error, hint, className, htmlFor, children }) {
  return (
    <div className={cn("space-y-1.5 min-w-0", className)}>
      <Label htmlFor={htmlFor} className="text-sm font-semibold text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs font-medium text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const invalidCls = (error) => (error ? "border-destructive focus-visible:ring-destructive/40" : "");

function TextField({ register, name, label, required, error, hint, className, ...inputProps }) {
  return (
    <Field label={label} required={required} error={error?.message} hint={hint} className={className} htmlFor={`emp-${name}`}>
      <Input id={`emp-${name}`} aria-invalid={!!error} className={cn("h-10", invalidCls(error))} {...register(name)} {...inputProps} />
    </Field>
  );
}

function EnumSelect({ control, name, label, required, error, options, placeholder, allowNone, className }) {
  return (
    <Field label={label} required={required} error={error?.message} className={className}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select
            value={field.value != null ? String(field.value) : ""}
            onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
          >
            <SelectTrigger className={cn("h-10", invalidCls(error))} aria-invalid={!!error}>
              <SelectValue placeholder={placeholder || `Select ${label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {allowNone && <SelectItem value="__none__">— None —</SelectItem>}
              {options.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  );
}

function LookupSelect({ control, name, label, options, labelKey, valueKey = "id", required, error, loading, onAfterChange, className }) {
  const list = options || [];
  return (
    <Field label={label} required={required} error={error?.message} className={className}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select
            value={field.value != null ? String(field.value) : ""}
            onValueChange={(v) => {
              const next = v === "__none__" ? null : Number(v);
              field.onChange(next);
              onAfterChange?.(next);
            }}
            disabled={loading}
          >
            <SelectTrigger className={cn("h-10", invalidCls(error))} aria-invalid={!!error}>
              <SelectValue placeholder={loading ? "Loading…" : `Select ${label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {!required && <SelectItem value="__none__">— None —</SelectItem>}
              {list.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Nothing set up yet</div>
              )}
              {list.map((opt) => (
                <SelectItem key={opt[valueKey]} value={String(opt[valueKey])}>
                  {opt[labelKey] || `#${opt[valueKey]}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  );
}

function MultiCheckList({ control, name, label, options, labelKey, valueKey = "id" }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <Label className="text-sm font-semibold">{label}</Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <div className="grid gap-1.5 rounded-lg border bg-muted/30 p-3 max-h-44 overflow-y-auto">
            {(options || []).length === 0 && <span className="text-xs text-muted-foreground">Nothing configured yet.</span>}
            {(options || []).map((opt) => {
              const id = opt[valueKey];
              const checked = !!field.value?.includes(id);
              return (
                <label key={id} className="flex items-center gap-2 text-sm cursor-pointer rounded px-1 py-0.5 hover:bg-accent">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      const next = v ? [...(field.value || []), id] : (field.value || []).filter((x) => x !== id);
                      field.onChange(next);
                    }}
                  />
                  <span className="truncate">{opt[labelKey]}</span>
                </label>
              );
            })}
          </div>
        )}
      />
    </div>
  );
}

function SectionTitle({ title, description }) {
  return (
    <div className="mb-5">
      <h3 className="text-lg font-bold tracking-tight text-foreground">{title}</h3>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

function PasswordInput({ id, register, name, error, show, onToggle, placeholder }) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        placeholder={placeholder}
        aria-invalid={!!error}
        className={cn("h-10 pr-10", invalidCls(error))}
        {...register(name)}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={onToggle}
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

const GRID = "grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4";

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

/**
 * onSubmit(payload) receives the final API payload (dates as ISO strings,
 * login fields only when they should be applied).
 * canAdministerAccess: the signed-in user may create/change logins.
 */
export default function EmployeeFormModal({
  open,
  onClose,
  employee,
  onSubmit,
  isSubmitting,
  serverError,
  canAdministerAccess = false,
  onDocumentsChange,
}) {
  const isEdit = !!employee;
  // Login roles from the catalogue; HR without users.manage is offered
  // staff / self-service roles only (the API enforces it — lib/auth/roleAssign.js).
  const { activeRoles: catalogue, roleName } = useRoles();
  const { can, fullAccess } = usePermissions();
  const existingUser = employee?.user || null;
  const activeRoles = catalogue.filter(
    (r) =>
      r.code === existingUser?.role ||
      (r.super_admin ? fullAccess : can("users.manage") || ["staff", "self"].includes(r.level)),
  );
  const hasExistingUser = !!existingUser;
  const [section, setSection] = useState("personal");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [documents, setDocuments] = useState(null);
  const [nextId, setNextId] = useState(null);
  const { data: lookups, isLoading: lookupsLoading, isError: lookupsError } = useEmployeeLookups(open);

  const schema = useMemo(() => buildFormSchema(hasExistingUser), [hasExistingUser]);

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    getValues,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: employeeToFormValues(employee),
  });

  useEffect(() => {
    if (!open) return;
    reset(employeeToFormValues(employee));
    setSection("personal");
    setShowPassword(false);
    setChangingPassword(false);
    setNextId(null);
    setDocuments(
      employee
        ? {
            photographUrl: employee.photographUrl,
            cnicDocumentUrl: employee.cnicDocumentUrl,
            educationalCertificates: employee.educationalCertificates || [],
            experienceCertificates: employee.experienceCertificates || [],
          }
        : null
    );
  }, [open, employee, reset]);

  // Pre-fill the Employee ID with the next free number (create only; editable).
  useEffect(() => {
    if (!open || isEdit) return;
    let cancelled = false;
    axios
      .get("/api/employees/next-id")
      .then((res) => {
        if (cancelled) return;
        setNextId(res.data.nextId);
        if (!getValues("id")) setValue("id", res.data.nextId);
      })
      .catch((err) => console.error("Error fetching next employee id:", err));
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, getValues, setValue]);

  const grantAccess = watch("grantAccess");
  const bankId = watch("bankId");
  const paymentMethod = watch("paymentMethod");
  const watchedId = watch("id");
  const firstName = watch("firstName");
  const surname = watch("surname");

  // Granting a login to an existing employee: username defaults to the id.
  useEffect(() => {
    if (grantAccess && isEdit && !hasExistingUser && !getValues("username")) {
      setValue("username", String(employee.id), { shouldDirty: true });
    }
  }, [grantAccess, isEdit, hasExistingUser, employee, getValues, setValue]);

  // Bank branches belong to a bank — only offer the selected bank's.
  const bankBranchOptions = useMemo(() => {
    const all = lookups?.bankBranches || [];
    return bankId ? all.filter((b) => b.bank_id === bankId) : all;
  }, [lookups, bankId]);

  const sectionErrorCount = useMemo(() => {
    const result = {};
    for (const s of SECTIONS) result[s.value] = s.fields.filter((f) => errors[f]).length;
    return result;
  }, [errors]);
  const totalErrors = Object.values(sectionErrorCount).reduce((a, b) => a + b, 0);

  const submitHandler = (values) => {
    const rest = { ...values };
    delete rest.confirmPassword;
    const loginTouched =
      !!rest.password ||
      ["username", "email", "role", "isActive"].some((f) => dirtyFields[f]);

    // Only send login changes when the user may make them and something
    // actually changed (or a new login is being granted).
    const applyLogin = canAdministerAccess && rest.grantAccess && (!hasExistingUser || loginTouched);

    const payload = {
      ...rest,
      id: isEdit ? employee.id : rest.id,
      dob: rest.dob ? new Date(rest.dob).toISOString() : null,
      dor: rest.dor ? new Date(rest.dor).toISOString() : null,
      hireDate: rest.hireDate ? new Date(rest.hireDate).toISOString() : null,
      grantAccess: !!applyLogin,
      username: applyLogin ? rest.username?.trim() || null : undefined,
      email: applyLogin ? rest.email?.trim() || undefined : undefined,
      role: applyLogin ? rest.role : undefined,
      password: applyLogin ? rest.password || undefined : undefined,
      isActive: applyLogin ? rest.isActive : undefined,
    };
    onSubmit(payload, { passwordChanged: applyLogin && !!rest.password, loginCreated: applyLogin && !hasExistingUser });
  };

  const onInvalid = (errs) => {
    const first = SECTIONS.find((s) => s.fields.some((f) => errs[f]));
    if (first) setSection(first.value);
    const count = Object.keys(errs).length;
    toast.error(`Please fix ${count} field${count === 1 ? "" : "s"} before saving`, {
      description: first ? `First problem is in "${first.label}"` : undefined,
    });
  };

  const fullName = [firstName, surname].filter(Boolean).join(" ");
  const initials = (fullName || "New Employee")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const loginSection = (() => {
    if (!canAdministerAccess) {
      return (
        <div className="rounded-xl border bg-muted/40 p-5 text-sm">
          {hasExistingUser ? (
            <div className="space-y-1">
              <p className="font-semibold">
                Login: <span className="font-mono">{existingUser.username || existingUser.email}</span> ·{" "}
                {roleName(existingUser.role)} · {existingUser.isActive ? "Active" : "Disabled"}
              </p>
              <p className="text-muted-foreground">Only an admin, HR manager or accountant can change logins.</p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              No system login. Only an admin, HR manager or accountant can grant access.
            </p>
          )}
        </div>
      );
    }

    if (!grantAccess) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center">
          <div className="rounded-full bg-muted p-3">
            <ShieldOff className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-base font-bold">No system login</p>
            <p className="text-sm text-muted-foreground">This employee cannot sign in to the system.</p>
          </div>
          <Button type="button" onClick={() => setValue("grantAccess", true, { shouldDirty: true })} className="gap-2">
            <KeyRound className="h-4 w-4" /> Grant access
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {hasExistingUser ? (
          <div className="flex flex-col gap-3 rounded-xl border bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="rounded-full bg-primary/15 p-2.5">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current login</p>
                <p className="truncate text-base font-bold">
                  <span className="font-mono">{existingUser.username || "—"}</span>
                  <span className="mx-2 text-muted-foreground">·</span>
                  {roleName(existingUser.role)}
                </p>
                <p className="truncate text-xs text-muted-foreground">{existingUser.email}</p>
              </div>
            </div>
            <span
              className={cn(
                "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-bold",
                existingUser.isActive
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700/50 dark:text-zinc-300"
              )}
            >
              {existingUser.isActive ? "Active" : "Disabled"}
            </span>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3 rounded-xl border bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
            <p className="text-amber-900 dark:text-amber-200">
              A new login will be created when you save. Set a username, role and password.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setValue("grantAccess", false);
                setValue("password", "");
                setValue("confirmPassword", "");
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        <div className={GRID}>
          <TextField
            register={register}
            name="username"
            label="Username"
            error={errors.username}
            autoComplete="off"
            placeholder={isEdit ? undefined : `Defaults to the employee ID${watchedId ? ` (${watchedId})` : ""}`}
            hint="Used to sign in. Must be unique; no @ sign."
          />
          <TextField
            register={register}
            name="email"
            label="Login email"
            type="email"
            error={errors.email}
            hint="Can also be used to sign in. Defaults to the employee email."
          />
          <EnumSelect
            control={control}
            name="role"
            label="Role"
            required
            error={errors.role}
            options={activeRoles.map((r) => ({
              value: r.code,
              label: r.name,
            }))}
          />
          <Field label="Login status">
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <label className="flex h-10 items-center gap-3 rounded-md border px-3 cursor-pointer">
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                  <span className="text-sm font-medium">{field.value ? "Active — can sign in" : "Disabled — cannot sign in"}</span>
                </label>
              )}
            />
          </Field>
        </div>

        <div className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <p className="text-sm font-bold">{hasExistingUser ? "Password" : "Set password"}</p>
            </div>
            {hasExistingUser && !changingPassword && (
              <Button type="button" variant="outline" size="sm" onClick={() => setChangingPassword(true)}>
                Change password
              </Button>
            )}
          </div>
          {hasExistingUser && !changingPassword ? (
            <p className="mt-2 text-sm text-muted-foreground">The current password is kept.</p>
          ) : (
            <div className={cn(GRID, "mt-4")}>
              <Field
                label={hasExistingUser ? "New password" : "Password"}
                required={!hasExistingUser}
                error={errors.password?.message}
                hint={hasExistingUser ? "Leave blank to keep the current password. Min 6 characters." : "Min 6 characters."}
                htmlFor="emp-password"
              >
                <PasswordInput
                  id="emp-password"
                  register={register}
                  name="password"
                  error={errors.password}
                  show={showPassword}
                  onToggle={() => setShowPassword((s) => !s)}
                />
              </Field>
              <Field label="Confirm password" required={!hasExistingUser} error={errors.confirmPassword?.message} htmlFor="emp-confirmPassword">
                <PasswordInput
                  id="emp-confirmPassword"
                  register={register}
                  name="confirmPassword"
                  error={errors.confirmPassword}
                  show={showPassword}
                  onToggle={() => setShowPassword((s) => !s)}
                />
              </Field>
              {hasExistingUser && (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setValue("password", "");
                      setValue("confirmPassword", "");
                      setChangingPassword(false);
                    }}
                  >
                    Keep current password
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isSubmitting && onClose()}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0 overflow-hidden",
          "w-full max-w-none h-[100dvh] rounded-none",
          "sm:h-[92vh] sm:max-w-5xl sm:rounded-xl"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b bg-card px-4 py-3 pr-14 sm:px-6 sm:py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {documents?.photographUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={documents.photographUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0">
            <DialogTitle className="truncate text-lg font-bold sm:text-xl">
              {isEdit ? fullName || "Edit employee" : "Add employee"}
            </DialogTitle>
            <DialogDescription className="truncate text-xs sm:text-sm">
              {isEdit
                ? `Employee #${employee.id}${employee.Designation?.desg_name ? ` · ${employee.Designation.desg_name}` : ""}`
                : `Fields marked * are required${nextId ? ` · next ID ${nextId}` : ""}`}
            </DialogDescription>
          </div>
        </div>

        <form onSubmit={handleSubmit(submitHandler, onInvalid)} className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Section nav: pills on phones, sidebar on desktop */}
          <nav
            aria-label="Form sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/40 px-3 py-2 md:w-52 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4"
          >
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const count = sectionErrorCount[s.value];
              const active = section === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSection(s.value)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{s.label}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
                        active ? "bg-primary-foreground text-primary" : "bg-destructive text-destructive-foreground"
                      )}
                    >
                      {count}
                    </span>
                  )}
                  {s.value === "login" && count === 0 && (grantAccess || hasExistingUser) && (
                    <span className={cn("ml-auto h-2 w-2 rounded-full", active ? "bg-primary-foreground" : "bg-emerald-500")} />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {lookupsError && (
              <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                Some dropdown lists could not be loaded. Close and reopen the form to retry.
              </p>
            )}

            <section hidden={section !== "personal"}>
              <SectionTitle title="Personal details" description="Who the employee is." />
              <div className={GRID}>
                <TextField
                  register={register}
                  name="id"
                  label="Employee ID"
                  type="number"
                  inputMode="numeric"
                  disabled={isEdit}
                  error={errors.id}
                  hint={isEdit ? "Fixed once the employee is created." : "Pre-filled with the next free ID — change only if needed."}
                />
                <EnumSelect
                  control={control}
                  name="status"
                  label="Employment status"
                  required
                  error={errors.status}
                  options={[
                    { value: "ACTIVE", label: "Active" },
                    { value: "INACTIVE", label: "Inactive" },
                  ]}
                />
                <TextField register={register} name="firstName" label="First name" required error={errors.firstName} autoComplete="off" />
                <TextField register={register} name="middleName" label="Middle name" error={errors.middleName} autoComplete="off" />
                <TextField register={register} name="surname" label="Surname" required error={errors.surname} autoComplete="off" />
                <EnumSelect
                  control={control}
                  name="gender"
                  label="Gender"
                  required
                  error={errors.gender}
                  options={[
                    { value: "Male", label: "Male" },
                    { value: "Female", label: "Female" },
                  ]}
                />
                <TextField register={register} name="dob" label="Date of birth" type="date" required error={errors.dob} />
                <TextField register={register} name="cnicNumber" label="CNIC number" error={errors.cnicNumber} placeholder="e.g. 35202-1234567-1" />
                <EnumSelect
                  control={control}
                  name="bloodGroup"
                  label="Blood group"
                  allowNone
                  error={errors.bloodGroup}
                  options={BLOOD_GROUPS}
                />
                <TextField register={register} name="qualification" label="Qualification" error={errors.qualification} placeholder="e.g. BSc Computer Science" />
              </div>
            </section>

            <section hidden={section !== "job"}>
              <SectionTitle title="Job" description="Where the employee works and reports." />
              <div className={GRID}>
                <LookupSelect control={control} name="departmentId" label="Department" options={lookups?.departments} labelKey="dept_name" required error={errors.departmentId} loading={lookupsLoading} />
                <LookupSelect control={control} name="designationId" label="Designation" options={lookups?.designations} labelKey="desg_name" required error={errors.designationId} loading={lookupsLoading} />
                <LookupSelect control={control} name="costCenterId" label="Cost center" options={lookups?.costCenters} labelKey="ccname" valueKey="ccno" required error={errors.costCenterId} loading={lookupsLoading} />
                <LookupSelect control={control} name="managerId" label="Reports to (manager)" options={lookups?.managers} labelKey="manager" error={errors.managerId} loading={lookupsLoading} />
                <LookupSelect control={control} name="branchId" label="Branch" options={lookups?.branches} labelKey="name" error={errors.branchId} loading={lookupsLoading} />
                <LookupSelect control={control} name="workLocationId" label="Work location" options={lookups?.workLocations} labelKey="location_name" error={errors.workLocationId} loading={lookupsLoading} />
                <LookupSelect control={control} name="employeetypeId" label="Employee type" options={lookups?.employeeTypes} labelKey="name" error={errors.employeetypeId} loading={lookupsLoading} />
                <LookupSelect control={control} name="employeecatId" label="Employee category" options={lookups?.employeeCategories} labelKey="name" error={errors.employeecatId} loading={lookupsLoading} />
                <TextField register={register} name="hireDate" label="Hire date" type="date" required error={errors.hireDate} />
                <TextField register={register} name="dor" label="Date of regularization" type="date" error={errors.dor} />
              </div>
            </section>

            <section hidden={section !== "contact"}>
              <SectionTitle title="Contact" description="How to reach the employee, and who to call in an emergency." />
              <div className={GRID}>
                <TextField register={register} name="phoneNumber" label="Phone number" required type="tel" inputMode="tel" error={errors.phoneNumber} placeholder="e.g. 0300-1234567" />
                <TextField register={register} name="emailAddress" label="Email" required type="email" error={errors.emailAddress} />
                <LookupSelect control={control} name="cityId" label="City" options={lookups?.cities} labelKey="name" error={errors.cityId} loading={lookupsLoading} />
                <TextField register={register} name="residentialAddress" label="Residential address" error={errors.residentialAddress} className="sm:col-span-2" />
              </div>
              <h4 className="mt-7 mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Emergency contact</h4>
              <div className={GRID}>
                <TextField register={register} name="emergencyContactName" label="Name" error={errors.emergencyContactName} />
                <TextField register={register} name="emergencyContactPhone" label="Phone" type="tel" inputMode="tel" error={errors.emergencyContactPhone} />
              </div>
              <h4 className="mt-7 mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Next of kin</h4>
              <div className={GRID}>
                <TextField register={register} name="nextOfKinName" label="Name" error={errors.nextOfKinName} />
                <TextField register={register} name="nextOfKinRelation" label="Relationship" error={errors.nextOfKinRelation} placeholder="e.g. Spouse, Parent" />
                <TextField register={register} name="nextOfKinPhone" label="Phone" type="tel" inputMode="tel" error={errors.nextOfKinPhone} />
              </div>
            </section>

            <section hidden={section !== "pay"}>
              <SectionTitle title="Pay & bank" description="Salary basis, payment method and bank account." />
              <div className={GRID}>
                <EnumSelect
                  control={control}
                  name="payType"
                  label="Pay type"
                  required
                  error={errors.payType}
                  options={[
                    { value: "SALARY", label: "Salary" },
                    { value: "HOUR", label: "Hourly" },
                  ]}
                />
                <TextField register={register} name="rate" label="Rate" required type="number" step="0.01" min="0" inputMode="decimal" error={errors.rate} hint="Monthly salary, or rate per hour for hourly staff." />
                <EnumSelect
                  control={control}
                  name="payFrequency"
                  label="Pay frequency"
                  required
                  error={errors.payFrequency}
                  options={[
                    { value: "MONTHLY", label: "Monthly" },
                    { value: "FORTNIGHTLY", label: "Fortnightly" },
                    { value: "WEEKLY", label: "Weekly" },
                  ]}
                />
                <EnumSelect
                  control={control}
                  name="paymentMethod"
                  label="Payment method"
                  required
                  error={errors.paymentMethod}
                  options={[
                    { value: "CASH", label: "Cash" },
                    { value: "DIRECT_DEPOSIT", label: "Direct deposit (bank)" },
                    { value: "CHEQUE", label: "Cheque" },
                  ]}
                />
              </div>

              <h4 className="mt-7 mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Bank account</h4>
              {paymentMethod === "DIRECT_DEPOSIT" && (
                <p className="mb-3 text-xs text-muted-foreground">Direct deposit — fill in the bank and account number.</p>
              )}
              <div className={GRID}>
                <LookupSelect
                  control={control}
                  name="bankId"
                  label="Bank"
                  options={lookups?.banks}
                  labelKey="name"
                  error={errors.bankId}
                  loading={lookupsLoading}
                  onAfterChange={(next) => {
                    const branchId = getValues("bank_bracnhId");
                    if (!branchId || !next) return;
                    const branch = (lookups?.bankBranches || []).find((b) => b.id === branchId);
                    if (branch && branch.bank_id !== next) setValue("bank_bracnhId", null, { shouldDirty: true });
                  }}
                />
                <LookupSelect control={control} name="bank_bracnhId" label="Bank branch" options={bankBranchOptions} labelKey="name" error={errors.bank_bracnhId} loading={lookupsLoading} />
                <TextField register={register} name="accountName" label="Account title" error={errors.accountName} />
                <TextField register={register} name="accountNumber" label="Account number" error={errors.accountNumber} />
              </div>

              <h4 className="mt-7 mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Allowances, deductions & leaves</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <MultiCheckList control={control} name="allowanceIds" label="Allowances" options={lookups?.allowances} labelKey="allowance" />
                <MultiCheckList control={control} name="deductionIds" label="Deductions" options={lookups?.deductions} labelKey="deduction" />
                <MultiCheckList control={control} name="leaveIds" label="Leaves" options={lookups?.leaves} labelKey="leave" />
              </div>
            </section>

            <section hidden={section !== "login"}>
              <SectionTitle title="System login" description="Lets the employee sign in to the system." />
              {loginSection}
            </section>

            <section hidden={section !== "documents"}>
              <SectionTitle title="Documents" description="Photograph, CNIC and certificates. Uploads save immediately." />
              {isEdit ? (
                <EmployeeDocumentsPanel
                  employeeId={employee.id}
                  documents={documents}
                  onChange={(next) => {
                    setDocuments(next);
                    onDocumentsChange?.(next);
                  }}
                />
              ) : (
                <div className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
                  Save the employee first, then open it again to upload documents.
                </div>
              )}
            </section>
          </div>
        </form>

        {/* Sticky footer */}
        <div className="flex flex-col gap-3 border-t bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-h-5 text-sm">
            {serverError ? (
              <p className="flex items-start gap-1.5 font-medium text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {serverError}
              </p>
            ) : totalErrors > 0 ? (
              <p className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertCircle className="h-4 w-4" />
                {totalErrors} field{totalErrors === 1 ? "" : "s"} need attention
              </p>
            ) : (
              <p className="hidden text-muted-foreground sm:block">
                <span className="text-destructive">*</span> required
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} className="flex-1 sm:flex-none">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit(submitHandler, onInvalid)}
              disabled={isSubmitting || lookupsLoading}
              className="flex-1 gap-2 font-semibold sm:flex-none sm:min-w-36"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                <Save className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Add employee"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
