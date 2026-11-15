// Handles notifications for user accounts and employee records.
import { NOTIFICATION_TYPES, NOTIFICATION_EXPIRY } from "../config";
import { emit } from "../emit";

const displayName = (u) => u.name || u.username || u.email;
const fullName = (e) => `${e.firstName} ${e.middleName || ""} ${e.surname}`.trim();

/**
 * User created. Subscribers hear about it; the new user themselves always gets
 * a welcome (extraUserIds bypasses role rules, actor* gives the personal wording).
 */
export async function userCreated(data, prisma) {
  try {
    await emit(prisma, "userCreated", {
      title: "New User Created",
      message: `New user account created: ${displayName(data)} (Role: ${data.role})`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "user",
      expiryDays: NOTIFICATION_EXPIRY.CRITICAL,
      extraUserIds: [data.id],
      actorUserId: data.id,
      actorTitle: "Welcome to the System",
      actorMessage: `Your account has been created successfully. Role: ${data.role}`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
    });
  } catch (error) {
    console.error("Error creating user notification:", error);
  }
}

/** User updated. The affected user is always told about changes to their own account. */
export async function userUpdated(data, prisma) {
  try {
    let type = NOTIFICATION_TYPES.INFO;
    let title = "User Account Updated";
    let expiryDays = NOTIFICATION_EXPIRY.DEFAULT;

    if (data.isActive === false) {
      type = NOTIFICATION_TYPES.WARNING;
      title = "Account Deactivated";
      expiryDays = NOTIFICATION_EXPIRY.CRITICAL;
    } else if (data.isActive === true) {
      type = NOTIFICATION_TYPES.SUCCESS;
      title = "Account Activated";
    }

    await emit(prisma, "userUpdated", {
      title,
      message: `User account updated: ${displayName(data)} - Status: ${data.isActive ? "Active" : "Inactive"}`,
      type,
      entity: "user",
      expiryDays,
      extraUserIds: [data.id],
      actorUserId: data.id,
      actorMessage: `Your account has been updated.${data.isActive === false ? " Your account has been deactivated." : ""}`,
    });
  } catch (error) {
    console.error("Error creating user update notification:", error);
  }
}

/** Employee created. */
export async function employeeCreated(data, prisma) {
  try {
    let departmentName = "Unknown Department";
    if (data.departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: data.departmentId },
        select: { dept_name: true },
      });
      departmentName = department?.dept_name || `Department #${data.departmentId}`;
    }

    await emit(prisma, "employeeCreated", {
      title: "New Employee Added",
      message: `${fullName(data)} added to ${departmentName}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "employee",
      entityId: data.id,
    });
  } catch (error) {
    console.error("Error creating employee notification:", error);
  }
}

/** Employee updated. */
export async function employeeUpdated(data, prisma) {
  try {
    const inactive = data.status === "INACTIVE";
    await emit(prisma, "employeeUpdated", {
      title: inactive ? "Employee Status Changed" : "Employee Record Updated",
      message: `Employee record updated: ${fullName(data)} - Status: ${data.status}`,
      type: inactive ? NOTIFICATION_TYPES.WARNING : NOTIFICATION_TYPES.INFO,
      entity: "employee",
      entityId: data.id,
    });
  } catch (error) {
    console.error("Error creating employee update notification:", error);
  }
}
