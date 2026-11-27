// /api/hr/letters/[id] — one HR letter (lib/hr/letters/*).
//
//   POST   multipart { file }  → the signed copy (scanned) is uploaded and kept on the letter
//   DELETE                     → the letter is withdrawn — only while no signed copy is on it
//
// Right hr.letters.issue; the employee must be in the person's HR scope.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, requireFeature } from "@/lib/hr/route";
import { uploadToSpaces } from "@/lib/space";
import { letterRow } from "@/lib/hr/letters/service";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(png|jpe?g|webp))$/;

async function load(params, session) {
  const id = intParam((await params).id);
  const letter = await prisma.hrLetter.findUnique({ where: { id } });
  if (!letter) throw Object.assign(new Error("Letter not found."), { status: 404 });
  await assertEmployeesInScope(session, [letter.employee_id]);
  return letter;
}

export const POST = hrRoute([HR_PERMS.lettersIssue], async (req, { params, session }) => {
  await requireFeature("hr.letters"); // Settings → Features
  const letter = await load(params, session);
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose the scanned signed copy." }, { status: 400 });
  if (!ALLOWED.test(file.type || "")) return NextResponse.json({ error: "Upload a PDF or a picture (PNG / JPG)." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is larger than 10 MB." }, { status: 400 });
  const url = await uploadToSpaces(Buffer.from(await file.arrayBuffer()), file.name, file.type, "employees/letters");
  const saved = await prisma.hrLetter.update({
    where: { id: letter.id },
    data: { signed_url: url, signed_at: new Date(), signed_by: session.user.id },
  });
  return NextResponse.json({ letter: letterRow(saved), message: `Signed copy of ${saved.ref_no} saved.` });
});

export const DELETE = hrRoute([HR_PERMS.lettersIssue], async (req, { params, session }) => {
  await requireFeature("hr.letters"); // Settings → Features
  const letter = await load(params, session);
  if (letter.signed_url) {
    return NextResponse.json({ error: "This letter has its signed copy on record — it cannot be withdrawn." }, { status: 409 });
  }
  await prisma.hrLetter.delete({ where: { id: letter.id } });
  return NextResponse.json({ success: true, message: `${letter.ref_no} withdrawn.` });
});
