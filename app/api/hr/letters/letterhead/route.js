// /api/hr/letters/letterhead — the letterhead HR letters print on
// (lib/hr/letters/letterhead.js).
//
//   GET                               → { letterhead }      (hr.letters.issue or .templates)
//   POST multipart { file, top?, bottom?, left?, right? }   (hr.letters.templates) — new picture
//   PUT  { top, bottom, left, right } (hr.letters.templates) — margins only
//   DELETE                            (hr.letters.templates) — back to the plain header
import { NextResponse } from "next/server";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody, requireFeature } from "@/lib/hr/route";
import { uploadToSpaces } from "@/lib/space";
import { getLetterhead, saveLetterhead } from "@/lib/hr/letters/letterhead";

const ALLOWED = /^image\/(png|jpe?g)$/i;
const MAX_BYTES = 5 * 1024 * 1024;
const margins = (src) => Object.fromEntries(["top", "bottom", "left", "right"].filter((k) => src[k] != null && src[k] !== "").map((k) => [k, Number(src[k])]));

export const GET = hrRoute([HR_PERMS.lettersIssue, HR_PERMS.lettersTemplates], async () => {
  await requireFeature("hr.letters"); // Settings → Features
  return NextResponse.json({ letterhead: await getLetterhead() });
});

export const POST = hrRoute([HR_PERMS.lettersTemplates], async (req) => {
  await requireFeature("hr.letters"); // Settings → Features
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose the letterhead picture." }, { status: 400 });
  if (!ALLOWED.test(file.type || "")) return NextResponse.json({ error: "Upload the letterhead as a PNG or JPG picture of the whole A4 page." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The picture is larger than 5 MB." }, { status: 400 });
  const url = await uploadToSpaces(Buffer.from(await file.arrayBuffer()), file.name, file.type, "hr/letterhead");
  const letterhead = await saveLetterhead({ url, ...margins(Object.fromEntries(form.entries())) });
  return NextResponse.json({ letterhead, message: "Letterhead saved — letters now print on it." });
});

export const PUT = hrRoute([HR_PERMS.lettersTemplates], async (req) => {
  await requireFeature("hr.letters"); // Settings → Features
  if (!(await getLetterhead())) return NextResponse.json({ error: "Upload the letterhead picture first." }, { status: 400 });
  const letterhead = await saveLetterhead(margins(await jsonBody(req)));
  return NextResponse.json({ letterhead, message: "Margins saved." });
});

export const DELETE = hrRoute([HR_PERMS.lettersTemplates], async () => {
  await requireFeature("hr.letters"); // Settings → Features
  await saveLetterhead({ url: null });
  return NextResponse.json({ letterhead: null, message: "Letterhead removed — letters print with the plain header." });
});
