// ============================================
// API ROUTE: GET /api/notifications/followups
// ============================================
// The bell's "Follow-up" tab: the follow-ups due for THIS person — a sales
// person their own customers' (Free of Cost / Trial …), the approvers of a
// scenario's approval rules all of its items. Same list as My Follow-ups
// (lib/bi/followupList.js); nobody is named in code. { enabled: false } when
// the person has no follow-ups at all — the bell then hides the tab.
//
// Read-only. Fetched only while the bell panel is open (not on its 1s poll).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listFollowups } from "@/lib/bi/followupList";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const list = await listFollowups(session, { box: "overdue", limit: 50 });
    return NextResponse.json({
      enabled: list.any,
      isManager: list.isManager,
      items: list.data.map((f) => ({
        id: f.id,
        scenario: f.scenario,
        label: f.label,
        customer: f.customer,
        owner: f.owner,
        overdue_days: f.overdue_days,
        escalated: f.escalated,
        last_note: f.last_note,
        last_note_by: f.last_note_by,
        result_label: f.result_label,
      })),
    });
  } catch (error) {
    console.error("Error loading follow-ups:", error);
    return NextResponse.json({ enabled: false, items: [] });
  }
}
