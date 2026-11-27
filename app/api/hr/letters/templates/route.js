// /api/hr/letters/templates — the wording of the HR letters (lib/hr/letters/*).
//
//   GET → { templates: { KIND: { subject, body } } }   (hr.letters.issue or .templates)
//   PUT { templates }                                   (hr.letters.templates)
//
// Placeholders such as {employee_name} are filled when a letter is issued;
// a change of wording applies to letters issued from then on.
import { NextResponse } from "next/server";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody, requireFeature } from "@/lib/hr/route";
import { letterTemplates, saveLetterTemplates } from "@/lib/hr/letters/service";

export const GET = hrRoute([HR_PERMS.lettersIssue, HR_PERMS.lettersTemplates], async () => {
  await requireFeature("hr.letters"); // Settings → Features
  return NextResponse.json({ templates: await letterTemplates() });
});

export const PUT = hrRoute([HR_PERMS.lettersTemplates], async (req) => {
  await requireFeature("hr.letters"); // Settings → Features
  const b = await jsonBody(req);
  const templates = await saveLetterTemplates(b.templates);
  return NextResponse.json({ templates, message: "Letter texts saved — they apply to letters issued from now on." });
});
