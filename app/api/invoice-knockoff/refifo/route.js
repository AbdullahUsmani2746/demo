import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import {
  applyRefifo,
  findRefifoParties,
  getRefifoJob,
  listRefifoBackups,
  restoreRefifo,
  resumeRefifo,
  startRefifoJob,
} from "@/lib/ledger/refifo";

// Fix FIFO order (lib/ledger/refifo.js) — Knock-Off Review, permission
// knockoff.refifo.
//   GET ?party=customer|vendor|all       affected parties + backups + the running job
//   POST ?action=apply   { party }       back up, reverse the automatic knock-offs, re-run FIFO
//   POST ?action=resume  { stamp }       finish an apply that stopped
//   POST ?action=restore { stamp }       put the parties back as backed up
// POST starts a background job and returns at once; the page polls GET.

const PARTIES = new Set(["customer", "vendor", "all"]);

export const GET = guard("knockoff.refifo", async (req) => {
  try {
    const asked = new URL(req.url).searchParams.get("party");
    const party = PARTIES.has(asked) ? asked : "all";
    const [parties, backups] = await Promise.all([findRefifoParties({ party }), listRefifoBackups()]);
    return NextResponse.json({ success: true, parties, backups, job: getRefifoJob() });
  } catch (error) {
    console.error("Error loading the FIFO check:", error);
    return NextResponse.json({ success: false, message: "Failed to load the FIFO check", error: error.message }, { status: 500 });
  }
});

const ACTIONS = {
  apply: (body, ctx) => (log) => applyRefifo({ party: PARTIES.has(body.party) ? body.party : "all", ...ctx, log }),
  resume: (body, ctx) => (log) => resumeRefifo(body.stamp, { ...ctx, log }),
  restore: (body) => (log) => restoreRefifo(body.stamp, { log }),
};

export const POST = guard("knockoff.refifo", async (req, { session }) => {
  try {
    const action = new URL(req.url).searchParams.get("action");
    if (!ACTIONS[action]) return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    if (action !== "apply" && !body.stamp) {
      return NextResponse.json({ success: false, message: "Backup stamp is required" }, { status: 400 });
    }
    const by = session?.user?.name || session?.user?.email || null;
    const job = startRefifoJob(action, by, ACTIONS[action](body, { userId: session?.user?.id ?? null, by }));
    return NextResponse.json({ success: true, job });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 409 });
  }
});
