// lib/hr/letters/letterhead.js — the company letterhead HR letters print on.
// DATA, not code: HR uploads the letterhead picture (a full A4 page: logo at
// the top, addresses at the bottom) on Employee → Documents → Letters →
// "Letter texts", with how much room its header / footer take, so the letter
// text always sits between them. Settings key `hr.letterhead`:
//   { url, top, bottom, left, right }   margins in mm
// No letterhead = the plain printed header (company name and address).
import prisma from "@/lib/prisma";

export const LETTERHEAD_KEY = "hr.letterhead";
export const LETTERHEAD_DEFAULT_MARGINS = { top: 40, bottom: 38, left: 20, right: 20 };

const mm = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 120 ? Math.round(n * 10) / 10 : d;
};

/** The saved letterhead, or null. */
export async function getLetterhead() {
  const row = await prisma.settings.findUnique({ where: { key: LETTERHEAD_KEY } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    if (!v?.url) return null;
    const d = LETTERHEAD_DEFAULT_MARGINS;
    return { url: String(v.url), top: mm(v.top, d.top), bottom: mm(v.bottom, d.bottom), left: mm(v.left, d.left), right: mm(v.right, d.right) };
  } catch {
    return null;
  }
}

/** Save the picture and / or the margins (patch); url null = remove it. */
export async function saveLetterhead(patch) {
  const cur = (await getLetterhead()) ?? { url: null, ...LETTERHEAD_DEFAULT_MARGINS };
  const d = LETTERHEAD_DEFAULT_MARGINS;
  const next = {
    url: patch.url === undefined ? cur.url : patch.url,
    top: mm(patch.top ?? cur.top, d.top),
    bottom: mm(patch.bottom ?? cur.bottom, d.bottom),
    left: mm(patch.left ?? cur.left, d.left),
    right: mm(patch.right ?? cur.right, d.right),
  };
  if (!next.url) {
    await prisma.settings.deleteMany({ where: { key: LETTERHEAD_KEY } });
    return null;
  }
  const value = JSON.stringify(next);
  await prisma.settings.upsert({
    where: { key: LETTERHEAD_KEY },
    update: { value },
    create: { key: LETTERHEAD_KEY, value, description: "HR letters: letterhead picture and the margins the text keeps from it" },
  });
  return next;
}
