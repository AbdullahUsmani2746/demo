import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uploadToSpaces } from "@/lib/space";
import { setAuditActor } from "@/lib/audit/context";
import { canManageEmployees } from "@/lib/employees";
import { guard } from "@/lib/auth/route";

const DOC_TYPES = {
    PHOTOGRAPH: { field: "photographUrl", multiple: false },
    CNIC: { field: "cnicDocumentUrl", multiple: false },
    EDUCATION_CERTIFICATE: { field: "educationalCertificates", multiple: true },
    EXPERIENCE_CERTIFICATE: { field: "experienceCertificates", multiple: true },
};

// Admin/HR (any role that can manage Employee Setup) can upload for anyone;
// an employee whose login id was provisioned as their own Employee id
// (see Employee Setup "System Access") can upload for themselves only.
async function canUploadFor(session, employeeId) {
    if ((await canManageEmployees(session))) return true;
    return String(employeeId) === session.user.id;
}

export const POST = guard("employee.manage", async (req) => {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const formData = await req.formData();
        const employeeId = Number(formData.get("employeeId"));
        const docType = formData.get("docType");

        if (!employeeId || !DOC_TYPES[docType]) {
            return NextResponse.json({ error: "Invalid employeeId or docType" }, { status: 400 });
        }

        if (!(await canUploadFor(session, employeeId))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
        if (!employee) {
            return NextResponse.json({ error: "Employee not found" }, { status: 404 });
        }

        const files = formData.getAll("file").filter((f) => typeof f !== "string");
        if (files.length === 0) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        const { field, multiple } = DOC_TYPES[docType];
        const uploadedUrls = [];
        for (const file of files) {
            const buffer = Buffer.from(await file.arrayBuffer());
            const url = await uploadToSpaces(buffer, file.name, file.type, "employees");
            uploadedUrls.push(url);
        }

        setAuditActor(session);

        const data = multiple
            ? { [field]: { push: uploadedUrls } }
            : { [field]: uploadedUrls[0] };

        const updated = await prisma.employee.update({
            where: { id: employeeId },
            data,
            select: { id: true, photographUrl: true, cnicDocumentUrl: true, educationalCertificates: true, experienceCertificates: true },
        });

        return NextResponse.json({ success: true, employee: updated, uploaded: uploadedUrls });
    } catch (error) {
        console.error("Error uploading employee document:", error);
        return NextResponse.json({ error: "Upload failed", message: error.message }, { status: 500 });
    }
});

export const DELETE = guard("employee.manage", async (req) => {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const employeeId = Number(searchParams.get("employeeId"));
        const docType = searchParams.get("docType");
        const url = searchParams.get("url");

        if (!employeeId || !DOC_TYPES[docType]) {
            return NextResponse.json({ error: "Invalid employeeId or docType" }, { status: 400 });
        }

        if (!(await canUploadFor(session, employeeId))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { field, multiple } = DOC_TYPES[docType];
        let data;

        if (multiple) {
            if (!url) {
                return NextResponse.json({ error: "url is required to remove a certificate" }, { status: 400 });
            }
            const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { [field]: true } });
            if (!employee) {
                return NextResponse.json({ error: "Employee not found" }, { status: 404 });
            }
            data = { [field]: (employee[field] || []).filter((u) => u !== url) };
        } else {
            data = { [field]: null };
        }

        setAuditActor(session);
        const updated = await prisma.employee.update({
            where: { id: employeeId },
            data,
            select: { id: true, photographUrl: true, cnicDocumentUrl: true, educationalCertificates: true, experienceCertificates: true },
        });

        return NextResponse.json({ success: true, employee: updated });
    } catch (error) {
        console.error("Error removing employee document:", error);
        return NextResponse.json({ error: "Remove failed", message: error.message }, { status: 500 });
    }
});
