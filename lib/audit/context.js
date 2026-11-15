import { AsyncLocalStorage } from "async_hooks";

// Carries "who is making this request" from a route handler to the Prisma
// client extension (lib/prisma.js), which has no per-request context of its
// own since it's a single global client shared by every request.
//
// Usage — add these two lines to any route handler right after it resolves
// the session, so writes made during that request are attributed correctly:
//
//   const session = await getServerSession(authOptions);
//   setAuditActor(session);
//
// enterWith() (not run()) is deliberate: it lets call sites add one line
// instead of wrapping the rest of the handler in a callback.
//
// Every request also gets a batch id: all the rows one save writes (a voucher
// header and its lines, an employee and their login …) share it, so the audit
// trail can show them as one change. Writes with no user (cron jobs, scripts)
// are recorded as source "system"; runAsSystem() names the job.

export const auditContext = new AsyncLocalStorage();

// A batch id only has to be unique, not secret — no "crypto" import, which
// the edge build of instrumentation.js cannot resolve.
export const newBatchId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function setAuditActor(session) {
  auditContext.enterWith({
    userId: session?.user?.id ?? null,
    userName: session?.user?.name ?? session?.user?.email ?? null,
    batchId: newBatchId(),
    source: session?.user?.id ? "user" : "system",
  });
}

/** Run `fn` as a named system job (cron, script): its writes are grouped and labelled. */
export function runAsSystem(job, fn) {
  // job: true — a named background job sees everything, also while off books
  // are hidden (lib/accounts/books.js); a request with no user does not.
  return auditContext.run({ userId: null, userName: `System: ${job}`, batchId: newBatchId(), source: "system", job: true }, fn);
}

export function getAuditActor() {
  return auditContext.getStore() ?? { userId: null, userName: null, batchId: null, source: "system" };
}
