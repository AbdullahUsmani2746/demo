import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { canManageEmployees, getNextEmployeeId } from "@/lib/employees";

// Suggests the next available Employee ID for the "Add Employee" form —
// pre-filled but editable, so the admin can still type a specific number.
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !(await canManageEmployees(session))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const nextId = await getNextEmployeeId(prisma);
        return NextResponse.json({ nextId });
    } catch (error) {
        console.error("Error computing next employee id:", error);
        return NextResponse.json({ error: "Failed to compute next id", message: error.message }, { status: 500 });
    }
}
