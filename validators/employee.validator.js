import { z } from "zod";

// Shared with the UI (admin Employee Setup + self-service profile page) so
// the dropdown options and the enum values stay in sync.
export const BLOOD_GROUPS = [
  { value: "A_POS", label: "A+" },
  { value: "A_NEG", label: "A-" },
  { value: "B_POS", label: "B+" },
  { value: "B_NEG", label: "B-" },
  { value: "AB_POS", label: "AB+" },
  { value: "AB_NEG", label: "AB-" },
  { value: "O_POS", label: "O+" },
  { value: "O_NEG", label: "O-" },
];

const requiredId = (message) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === 0 ? undefined : v),
    z.coerce.number({ required_error: message, invalid_type_error: message }).int().positive(message)
  );

// Login usernames: trimmed, no "@" (sign-in treats "a@b.c" as an email).
export const usernameSchema = z
  .string()
  .trim()
  .max(25, "Username can be at most 25 characters")
  .refine((v) => !v.includes("@"), "Username cannot contain @");

// A login role is any role in the catalogue (Admin → Roles); the API checks it
// (lib/auth/roleAssign.js).

// Core Employee (HR/payroll) fields. The optional "System Access" fields
// (email/password/role for the linked User login) are validated separately
// in the API route since they're only required when grantAccess is true.
export const employeeSchema = z.object({
  // Optional client-supplied Employee ID (pre-filled with the next available
  // number in the UI, but editable). Ignored on update — the id is fixed
  // once an employee exists. On create, falls back to max(id)+1 if omitted.
  id: z.coerce.number().int().positive().optional(),
  firstName: z.string().min(1, "First name is required").max(25),
  middleName: z.string().max(25).optional().nullable(),
  surname: z.string().min(1, "Surname is required").max(25),
  dob: z.coerce.date({ required_error: "Date of birth is required" }),
  gender: z.enum(["Male", "Female"]),
  phoneNumber: z.string().min(1, "Phone number is required").max(25),
  emailAddress: z.string().email("Enter a valid email address"),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  cnicNumber: z.string().max(25).optional().nullable(),
  dor: z.coerce.date().optional().nullable(),
  hireDate: z.coerce.date({ required_error: "Hire date is required" }),

  // null/"" must fail here: z.coerce.number() would turn them into 0.
  designationId: requiredId("Designation is required"),
  departmentId: requiredId("Department is required"),
  workLocationId: z.coerce.number().int().optional().nullable(),
  employeecatId: z.coerce.number().int().optional().nullable(),
  employeetypeId: z.coerce.number().int().optional().nullable(),
  cityId: z.coerce.number().int().optional().nullable(),
  branchId: z.coerce.number().int().optional().nullable(),
  managerId: z.coerce.number().int().optional().nullable(),

  paymentMethod: z.enum(["CASH", "DIRECT_DEPOSIT", "CHEQUE"]),
  bankId: z.coerce.number().int().optional().nullable(),
  bank_bracnhId: z.coerce.number().int().optional().nullable(),
  accountName: z.string().max(25).optional().nullable(),
  accountNumber: z.string().max(25).optional().nullable(),
  payType: z.enum(["HOUR", "SALARY"]).default("SALARY"),
  rate: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number({ required_error: "Rate is required", invalid_type_error: "Rate must be a number" }).min(0, "Rate cannot be negative")
  ),
  payFrequency: z.enum(["MONTHLY", "FORTNIGHTLY", "WEEKLY"]).default("MONTHLY"),
  costCenterId: requiredId("Cost center is required"),
  // Salary category: Direct / Indirect (optional)
  salaryCategory: z.enum(["DIRECT", "INDIRECT"]).optional().nullable(),

  allowanceIds: z.array(z.coerce.number().int()).optional().default([]),
  deductionIds: z.array(z.coerce.number().int()).optional().default([]),
  leaveIds: z.array(z.coerce.number().int()).optional().default([]),

  qualification: z.string().max(150).optional().nullable(),
  emergencyContactName: z.string().max(100).optional().nullable(),
  emergencyContactPhone: z.string().max(25).optional().nullable(),
  residentialAddress: z.string().max(255).optional().nullable(),
  bloodGroup: z.enum(BLOOD_GROUPS.map((b) => b.value)).optional().nullable(),
  nextOfKinName: z.string().max(100).optional().nullable(),
  nextOfKinRelation: z.string().max(50).optional().nullable(),
  nextOfKinPhone: z.string().max(25).optional().nullable(),
});

// System-access fields, only enforced when grantAccess is true (checked
// separately since password is required on create but optional on update).
export const employeeAccessSchema = z.object({
  grantAccess: z.boolean().default(false),
  username: usernameSchema.optional().nullable(),
  email: z.string().trim().email("Enter a valid login email").optional(),
  role: z.string().trim().max(40).optional(),
  // Extra roles (user_roles) besides the main one; omitted = keep what the login has.
  roles: z.array(z.string().trim().max(40)).max(50).optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  isActive: z.boolean().default(true),
});

export function validateEmployee(data) {
  return employeeSchema.safeParse(data);
}

export function validateEmployeeAccess(data) {
  return employeeAccessSchema.safeParse(data);
}
