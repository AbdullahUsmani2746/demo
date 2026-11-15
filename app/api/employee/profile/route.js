import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from "@/lib/prisma";
import { canManageEmployees } from "@/lib/employees";
import { setAuditActor } from "@/lib/audit/context";

// Fields an employee may edit about themselves. Anything HR/payroll-owned
// (rate, department, designation, status, ids, ...) is deliberately left out
// — those only change through Employee Setup (admin/HR).
const SELF_EDITABLE_FIELDS = [
  "phoneNumber",
  "cnicNumber",
  "accountName",
  "accountNumber",
  "qualification",
  "emergencyContactName",
  "emergencyContactPhone",
  "residentialAddress",
  "bloodGroup",
  "nextOfKinName",
  "nextOfKinRelation",
  "nextOfKinPhone",
];

// An employee may only look at / edit their own record — their User.id was
// set to their Employee.id when access was granted via Employee Setup — or
// an admin/HR/accountant/manager acting on Employee Setup's behalf.
async function canAccess(session, employeeId) {
  if ((await canManageEmployees(session))) return true;
  return String(employeeId) === session.user.id;
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      );
    }

    if (!(await canAccess(session, id))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const employee = await prisma.employee.findUnique({
      where: {
        id: parseInt(id),
      },
      include: {
        Designation: true,
        department: true,
        workLocation: true,
        employeecat: true,
        employeetype: true,
        city: true,
        branch: true,
        manager: true,
        company: true,
        bank: true,
        bankBranch: true,
        costCenter: true,
        allowances: true,
        deductions: true,
        leaves: true,

      },
    });

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ employee }, { status: 200 });
  } catch (error) {
    console.error('Error fetching employee profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch employee profile' },
      { status: 500 }
    );
  }
}

export async function PUT(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      );
    }

    if (!(await canAccess(session, id))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Admin/HR editing through this endpoint gets the same self-service
    // allowlist — full HR/payroll edits go through Employee Setup instead.
    const safeUpdateData = {};
    for (const field of SELF_EDITABLE_FIELDS) {
      if (field in body) safeUpdateData[field] = body[field];
    }

    setAuditActor(session);

    const updatedEmployee = await prisma.employee.update({
      where: {
        id: parseInt(id),
      },
      data: safeUpdateData,
    });

    return NextResponse.json(
      { message: 'Profile updated successfully', employee: updatedEmployee },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating employee profile:', error);
    return NextResponse.json(
      { error: 'Failed to update employee profile' },
      { status: 500 }
    );
  }
}
