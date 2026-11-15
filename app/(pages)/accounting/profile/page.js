"use client";
import React, { useState, useEffect } from "react";
import {
  User,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Briefcase,
  Building2,
  CreditCard,
  DollarSign,
  Users,
  Clock,
  Award,
  TrendingUp,
  TrendingDown,
  Edit2,
  Save,
  X,
  Shield,
  HeartPulse,
  Home,
  Contact,
  Loader2,
  Lock,
  UserCircle2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import EmployeeDocumentsPanel from "@/components/Employees/EmployeeDocumentsPanel";
import { BLOOD_GROUPS } from "@/validators/employee.validator";
import {
  LabCard, LabEmpty, Chip, CODE_CHIP, TH, TD, NUM, TOTAL_ROW, TABS_SCROLL,
} from "@/components/Material/shared/LabUI";

// Status → Chip tone (components/Material/shared/LabUI.jsx).
const STATUS_TONE = { ACTIVE: "ok", INACTIVE: "bad", ON_LEAVE: "warn" };
const INPUT_CLS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15";

const ProfilePage = () => {
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [activeTab, setActiveTab] = useState("personal");
  const [saving, setSaving] = useState(false);

  const { data: session, status: sessionStatus } = useSession();
  const queryClient = useQueryClient();

  // TanStack Query for fetching employee profile
  const {
    data: queryData,
    isLoading: queryLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["employeeProfile", session?.user?.id],
    queryFn: async () => {
      const response = await axios.get(
        `/api/employee/profile?id=${session?.user?.id}`
      );
      return response.data;
    },
    enabled: !!session?.user?.id,
  });

  // TanStack Query Mutation for updating profile
  const updateProfileMutation = useMutation({
    mutationFn: async (data) => {
      const response = await fetch("/api/employee/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error("Failed to update profile");
      }
      return response.json();
    },
    onSuccess: (data) => {
      // Update local state
      setEmployee(editData);
      setIsEditing(false);

      // Invalidate and refetch the query
      queryClient.invalidateQueries({ queryKey: ["employeeProfile"] });
    },
    onError: (error) => {
      console.error("Error updating profile:", error);
    },
  });

  // Load once the session (and so the user id) is known — before that the
  // request went out as ?id=undefined and the page showed "not found".
  useEffect(() => {
    if (session?.user?.id) fetchEmployeeProfile();
    else if (sessionStatus === "unauthenticated") setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, sessionStatus]);

  const fetchEmployeeProfile = async () => {
    try {
      const response = await axios.get(
        `/api/employee/profile?id=${session?.user?.id}`
      );
      const data = await response.data;
      setEmployee(data.employee);
      setEditData(data.employee);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching profile:", error);
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditData(employee);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/employee/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editData),
      });

      if (response.ok) {
        setEmployee(editData);
        setIsEditing(false);
        toast.success("Profile updated");
      } else {
        let msg = "Could not update your profile";
        try { msg = (await response.json())?.error || msg; } catch { /* empty body */ }
        toast.error(msg);
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Could not update your profile");
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (field, value) => {

    setEditData({ ...editData, [field]: value });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/40">
        <main className="mx-auto max-w-[1600px] space-y-5 px-3 py-5 sm:px-6" aria-busy="true" aria-label="Loading profile">
          <div className="flex items-center gap-4 rounded-xl border border-border bg-background p-5">
            <Skeleton className="h-16 w-16 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
          <Skeleton className="h-10 w-full rounded-lg" />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        </main>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-muted/40">
        <main className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
          <div className="rounded-xl border border-border bg-background">
            <LabEmpty icon={UserCircle2} title="Employee profile not found" hint="Your user is not linked to an employee record. Ask HR to grant access from Employee Setup." />
          </div>
        </main>
      </div>
    );
  }

  const tabs = [
    { id: "personal", label: "Personal Info", icon: User },
    { id: "employment", label: "Employment", icon: Briefcase },
    { id: "financial", label: "Financial", icon: DollarSign },
    { id: "compensation", label: "Compensation", icon: TrendingUp },
    { id: "additional", label: "Additional Info", icon: HeartPulse },
  ];

  const formatDate = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getInitials = () => {
    return `${employee.firstName?.[0] || ""}${employee.surname?.[0] || ""}`.toUpperCase() || "?";
  };

  const money = (n) => `PKR ${Number(n || 0).toLocaleString()}`;
  const fullName = [employee.firstName, employee.middleName, employee.surname].filter(Boolean).join(" ");
  const allowanceTotal = (editData.allowances || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  const deductionTotal = (editData.deductions || []).reduce((s, d) => s + Number(d.amount || 0), 0);

  // Shorthand for a field the employee may change themselves (the API's
  // SELF_EDITABLE_FIELDS); everything else is read-only here.
  const own = (field) => ({
    value: editData[field],
    isEditing,
    onChange: (v) => handleInputChange(field, v),
  });

  return (
    <div className="min-h-screen bg-muted/40">
      <main className={cn("mx-auto max-w-[1600px] space-y-5 px-3 py-5 sm:px-6", isEditing && "pb-0")}>
        {/* Profile header card */}
        <section className="overflow-clip rounded-xl border border-border bg-background">
          <div className="h-16 bg-gradient-to-r from-[#800000] to-[#5c0000] sm:h-20" aria-hidden="true" />
          <div className="flex flex-col gap-4 px-4 pb-4 sm:flex-row sm:items-end sm:px-6">
            <div className="-mt-10 flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl border-4 border-background bg-primary text-2xl font-bold text-primary-foreground shadow-md sm:-mt-12 sm:h-24 sm:w-24 sm:text-3xl">
              {getInitials()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-muted-foreground">Accounting · My profile</p>
              <h1 className="break-words text-2xl font-bold tracking-tight text-foreground">{fullName}</h1>
              <p className="text-sm text-muted-foreground">{employee.Designation?.designation || "N/A"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip tone={STATUS_TONE[employee.status] || "muted"}>{employee.status}</Chip>
                <span className={CODE_CHIP}>ID {employee.id}</span>
                {employee.department?.department_name && <Chip tone="brand">{employee.department.department_name}</Chip>}
              </div>
            </div>
            <div className="flex w-full flex-wrap gap-2 max-sm:[&>*]:flex-1 sm:w-auto">
              {!isEditing && (
                <Button onClick={handleEdit} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                  <Edit2 className="h-4 w-4" />
                  Edit Profile
                </Button>
              )}
            </div>
          </div>
          {/* Quick facts */}
          <dl className="grid grid-cols-1 gap-px border-t border-border bg-border min-[420px]:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Mail, label: "Email", value: employee.emailAddress || "N/A" },
              { icon: Phone, label: "Phone", value: employee.phoneNumber || "N/A" },
              { icon: Building2, label: "Work Location", value: employee.workLocation?.location_name || "N/A" },
              { icon: Calendar, label: "Hire Date", value: formatDate(employee.hireDate) },
            ].map((f) => (
              <div key={f.label} className="flex min-w-0 items-center gap-3 bg-background px-4 py-3">
                <f.icon className="h-4 w-4 flex-shrink-0 text-primary" />
                <div className="min-w-0">
                  <dt className="text-[11.5px] text-muted-foreground">{f.label}</dt>
                  <dd className="truncate text-sm font-medium text-foreground" title={f.value}>{f.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        {isEditing && (
          <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
            <Edit2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
            <p>
              You can change your contact, bank account, qualification, emergency contact and next-of-kin details.
              Fields marked <Lock className="inline h-3 w-3 align-[-1px] text-muted-foreground" /> are kept by HR in Employee Setup.
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className={TABS_SCROLL}>
          <div role="tablist" aria-label="Profile sections" className="inline-flex w-max min-w-full gap-1 border-b border-border">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const on = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-2 text-sm font-medium transition-colors",
                    on ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        {activeTab === "personal" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <InfoCard title="Contact Information" icon={Mail}>
              <InfoItem icon={Mail} label="Email" value={editData.emailAddress} locked={isEditing} />
              <InfoItem icon={Phone} label="Phone" {...own("phoneNumber")} />
              <InfoItem icon={Shield} label="CNIC" {...own("cnicNumber")} />
            </InfoCard>

            <InfoCard title="Personal Details" icon={User}>
              <InfoItem icon={Calendar} label="Date of Birth" value={formatDate(editData.dob)} locked={isEditing} />
              <InfoItem icon={User} label="Gender" value={editData.gender} locked={isEditing} />
              <InfoItem icon={MapPin} label="City" value={editData.city?.city_name} locked={isEditing} />
            </InfoCard>

            <InfoCard title="Location Details" icon={MapPin}>
              <InfoItem icon={Building2} label="Work Location" value={editData.workLocation?.location_name} locked={isEditing} />
              <InfoItem icon={Building2} label="Branch" value={editData.branch?.branch_name} locked={isEditing} />
              <InfoItem icon={Building2} label="Company" value={editData.company?.company_name} locked={isEditing} />
            </InfoCard>
          </div>
        )}

        {activeTab === "employment" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <InfoCard title="Job Information" icon={Briefcase}>
              <InfoItem icon={Award} label="Designation" value={editData.Designation?.designation} locked={isEditing} />
              <InfoItem icon={Building2} label="Department" value={editData.department?.department_name} locked={isEditing} />
              <InfoItem icon={Briefcase} label="Employment Type" value={editData.employeetype?.cat_name} locked={isEditing} />
              <InfoItem icon={Briefcase} label="Employment Category" value={editData.employeecat?.cat_name} locked={isEditing} />
            </InfoCard>

            <InfoCard title="Timeline" icon={Calendar}>
              <InfoItem icon={Calendar} label="Hire Date" value={formatDate(editData.hireDate)} locked={isEditing} />
              <InfoItem icon={Calendar} label="Date of Resignation" value={formatDate(editData.dor)} locked={isEditing} />
              <InfoItem
                icon={Clock}
                label="Years of Service"
                locked={isEditing}
                value={
                  editData.hireDate
                    ? `${Math.floor(
                      (new Date() - new Date(editData.hireDate)) /
                      (365 * 24 * 60 * 60 * 1000)
                    )} years`
                    : "N/A"
                }
              />
            </InfoCard>

            {editData.manager && (
              <InfoCard title="Reporting Structure" icon={Users}>
                <InfoItem
                  icon={Users}
                  label="Reports To"
                  value={`${editData.manager.employee?.firstName} ${editData.manager.employee?.surname}`}
                  locked={isEditing}
                />
                <InfoItem icon={Mail} label="Manager Email" value={editData.manager.employee?.emailAddress} locked={isEditing} />
              </InfoCard>
            )}
          </div>
        )}

        {activeTab === "financial" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <InfoCard title="Payment Details" icon={CreditCard}>
              <InfoItem icon={CreditCard} label="Payment Method" value={editData.paymentMethod} locked={isEditing} />
              <InfoItem icon={CreditCard} label="Bank" value={editData.bank?.bank_name} locked={isEditing} />
              <InfoItem icon={Building2} label="Bank Branch" value={editData.bankBranch?.branch_name} locked={isEditing} />
              <InfoItem icon={User} label="Account Name" {...own("accountName")} />
              <InfoItem icon={CreditCard} label="Account Number" {...own("accountNumber")} mono />
            </InfoCard>

            <InfoCard title="Cost Center" icon={DollarSign}>
              <InfoItem icon={Building2} label="Cost Center" value={editData.costCenter?.cc_name} locked={isEditing} />
              <InfoItem icon={Building2} label="Cost Center Code" value={editData.costCenter?.ccno} locked={isEditing} mono />
            </InfoCard>
          </div>
        )}

        {activeTab === "compensation" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <InfoCard title="Salary Details" icon={DollarSign}>
              <InfoItem icon={DollarSign} label="Pay Type" value={editData.payType} locked={isEditing} />
              <InfoItem icon={DollarSign} label="Rate" value={editData.rate != null ? money(editData.rate) : null} locked={isEditing} />
              <InfoItem icon={Calendar} label="Pay Frequency" value={editData.payFrequency} locked={isEditing} />
            </InfoCard>

            {editData.allowances?.length > 0 && (
              <AmountCard
                title="Allowances"
                icon={TrendingUp}
                rows={editData.allowances.map((a) => ({ name: a.AllowanceType?.type_name, amount: a.amount }))}
                total={allowanceTotal}
                money={money}
              />
            )}

            {editData.deductions?.length > 0 && (
              <AmountCard
                title="Deductions"
                icon={TrendingDown}
                rows={editData.deductions.map((d) => ({ name: d.deductionType?.deduction_name, amount: d.amount }))}
                total={deductionTotal}
                money={(n) => `- ${money(n)}`}
                negative
              />
            )}
          </div>
        )}

        {activeTab === "additional" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <InfoCard title="Personal Details" icon={HeartPulse}>
              <InfoItem icon={Award} label="Qualification" {...own("qualification")} />
              <Field icon={HeartPulse} label="Blood Group">
                {isEditing ? (
                  <select
                    value={editData.bloodGroup || ""}
                    onChange={(e) => handleInputChange("bloodGroup", e.target.value || null)}
                    className={INPUT_CLS}
                  >
                    <option value="">— None —</option>
                    {BLOOD_GROUPS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="break-words text-sm font-medium text-foreground">
                    {BLOOD_GROUPS.find((b) => b.value === editData.bloodGroup)?.label || "N/A"}
                  </p>
                )}
              </Field>
              <InfoItem icon={Home} label="Residential Address" {...own("residentialAddress")} wide />
            </InfoCard>

            <InfoCard title="Emergency Contact" icon={Contact}>
              <InfoItem icon={Contact} label="Name" {...own("emergencyContactName")} />
              <InfoItem icon={Phone} label="Phone" {...own("emergencyContactPhone")} />
            </InfoCard>

            <InfoCard title="Next of Kin" icon={Users}>
              <InfoItem icon={Users} label="Name" {...own("nextOfKinName")} />
              <InfoItem icon={Users} label="Relationship" {...own("nextOfKinRelation")} />
              <InfoItem icon={Phone} label="Phone" {...own("nextOfKinPhone")} />
            </InfoCard>

            <LabCard title="Documents" icon={Shield} bodyClassName="p-4">
              <EmployeeDocumentsPanel
                employeeId={employee.id}
                documents={editData}
                onChange={(updated) => {
                  setEmployee((prev) => ({ ...prev, ...updated }));
                  setEditData((prev) => ({ ...prev, ...updated }));
                }}
              />
            </LabCard>
          </div>
        )}

        {/* Sticky footer while editing */}
        {isEditing && (
          <div className="sticky bottom-0 z-20 -mx-3 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6">
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-end gap-2 px-3 py-3 sm:px-6 max-sm:[&>button]:flex-1">
              <span className="mr-auto hidden text-sm text-muted-foreground sm:inline">Editing your profile</span>
              <Button variant="outline" onClick={handleCancel} disabled={saving} className="gap-1.5">
                <X className="h-4 w-4" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Changes
              </Button>
            </div>
          </div>
        )}
      </main>

    </div>
  );
};

/** Section card: tinted header, fields two per row on wide screens. */
const InfoCard = ({ title, icon, children }) => (
  <LabCard title={title} icon={icon}>
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-2">{children}</dl>
  </LabCard>
);

/** Label + icon + any content. */
const Field = ({ icon: Icon, label, locked, wide, children }) => (
  <div className={cn("flex min-w-0 items-start gap-3", wide && "sm:col-span-2")}>
    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
    <div className="min-w-0 flex-1">
      <dt className="mb-1 flex items-center gap-1 text-[12px] text-muted-foreground">
        {label}
        {locked && <Lock className="h-3 w-3" aria-label="Kept by HR" />}
      </dt>
      <dd>{children}</dd>
    </div>
  </div>
);

/** A field: read-only text, or an input when the employee may edit it. */
const InfoItem = ({
  icon,
  label,
  value,
  isEditing,
  onChange,
  locked,
  wide,
  mono,
  type = "text",
}) => (
  <Field icon={icon} label={label} locked={locked} wide={wide}>
    {isEditing && onChange ? (
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={INPUT_CLS}
      />
    ) : (
      <p className={cn("break-words text-sm font-medium text-foreground", mono && "font-mono", (value == null || value === "") && "text-muted-foreground")}>
        {value == null || value === "" ? "N/A" : value}
      </p>
    )}
  </Field>
);

/** Allowances / deductions: name + amount, totals row. */
const AmountCard = ({ title, icon, rows, total, money, negative }) => (
  <LabCard title={title} icon={icon}>
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className={TH}>Type</th>
          <th className={`${TH} text-right`}>Amount</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r, idx) => (
          <tr key={idx}>
            <td className={`${TD} text-foreground`}>{r.name}</td>
            <td className={`${TD} ${NUM} font-semibold ${negative ? "text-destructive" : "text-foreground"}`}>{money(r.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={TOTAL_ROW}>
          <td className={TD}>Total</td>
          <td className={`${TD} ${NUM} ${negative ? "text-destructive" : ""}`}>{money(total)}</td>
        </tr>
      </tfoot>
    </table>
  </LabCard>
);

export default ProfilePage;
