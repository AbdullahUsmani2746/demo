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

// One store per process, kept on globalThis: the Prisma client is a global
// singleton (lib/prisma.js) built by whichever bundle loaded first
// (instrumentation, a route …), and a dev / Turbopack server can load this
// module once per bundle. A store per module copy left the client reading an
// empty one — every audit row came out as "system" with no user and its own
// batch.
export const auditContext = (globalThis.__bizlogistAuditContext ??= new AsyncLocalStorage());

// A batch id only has to be unique, not secret — no "crypto" import, which
// the edge build of instrumentation.js cannot resolve.
export const newBatchId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const actorOf = (session) => ({
  userId: session?.user?.id ?? null,
  userName: session?.user?.name ?? session?.user?.email ?? null,
  batchId: newBatchId(),
  source: session?.user?.id ? "user" : "system",
});

// enterWith() changes the store only for the code that follows in the SAME
// async function (and what it starts). Called inside a helper that the route
// awaits (lib/auth/route.js authorize()), it does not reach the route's own
// code in the Next.js server — every write of a guard()-wrapped route was
// recorded as "system" with no user. Call it in the function that writes, or
// use runAsActor().
export function setAuditActor(session) {
  auditContext.enterWith(actorOf(session));
}

/** Run `fn` with `session` as the audit actor — an explicit scope (guard() / guardBy()). */
export function runAsActor(session, fn) {
  return auditContext.run(actorOf(session), fn);
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
