// /api/hr/leaving/settings — the clearance checklist (Settings "hr.leaving.clearance_items").
//   GET → { items }      leaving rights
//   PUT { items: [{ key?, label }] }   hr.leaving.manage
// New leavings copy the list; open ones keep the list they started with.
import { NextResponse } from "next/server";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody, requireFeature } from "@/lib/hr/route";
import { getClearanceItems, saveClearanceItems } from "@/lib/hr/settingsData";

export const GET = hrRoute([HR_PERMS.leavingManage, HR_PERMS.leavingApprove, HR_PERMS.settlementManage], async () => {
  await requireFeature("hr.leavingProcess");
  return NextResponse.json({ items: await getClearanceItems() });
});

export const PUT = hrRoute([HR_PERMS.leavingManage], async (req) => {
  await requireFeature("hr.leavingProcess");
  const b = await jsonBody(req);
  return NextResponse.json({ items: await saveClearanceItems(b.items), message: "Checklist saved." });
});
