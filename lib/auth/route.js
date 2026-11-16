// lib/auth/route.js
// ============================================================
// The guard every mutating API route should go through.
//
// Before this existed, middleware.js required a *session* on /api/* but
// checked roles only on page paths — so any signed-in user could POST
// directly to any route regardless of their role. `guard()` closes that:
// one line at the top of a handler states the permission it needs, and the
// session, the audit actor and the permission are all settled together.
//
//   export const POST = guard("saleOrder.create", async (req, ctx) => { … })
//
// or, when a handler needs the session before deciding:
//
//   const { session, constraints } = await authorize("dispatch.unlock")
// ============================================================
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setAuditActor, runAsActor } from "@/lib/audit/context";
import { requirePermission, ForbiddenError } from "./permissions";

export class UnauthorizedError extends Error {
  constructor(message = "You must be signed in.") {
    super(message);
    this.name = "UnauthorizedError";
    this.status = 401;
  }
}

/**
 * Session + permission + audit actor in one call.
 * @param {string|null} code permission required, or null for "signed in only"
 * @returns {Promise<{session: object, constraints: object|null}>}
 */
export async function authorize(code = null) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new UnauthorizedError();

  // A session whose token was revoked mid-flight (deactivated account) must
  // not pass, even if middleware was bypassed by a direct server call.
  if (session.blocked) throw new UnauthorizedError(session.blocked);

  // Every write is attributed; routes used to forget this individually.
  setAuditActor(session);

  const constraints = code ? await requirePermission(session, code) : null;
  return { session, constraints };
}

/** Turn a thrown auth error into the right response; re-throw anything else. */
export function authErrorResponse(error) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { error: error.message, permission: error.code },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Like guard(), but the permission code is computed from the request.
 *
 * The document engine and the setup CRUD each serve dozens of types through
 * one file, so their code depends on the URL: /api/voucher/dispatch needs
 * dispatch.create, /api/setup/items needs setup.items.manage.
 *
 *   export const POST = guardBy(
 *     async (req, { params }) => `${(await params).type}.create`,
 *     async (req, ctx) => { … },
 *   )
 *
 * `codeFor` must not read the request body — a body can only be consumed
 * once, and the handler needs it.
 */
export function guardBy(codeFor, handler) {
  return async function guardedRoute(req, ctx = {}) {
    let session, constraints;
    try {
      const code = await codeFor(req, ctx);
      ({ session, constraints } = await authorize(code));
    } catch (error) {
      const res = authErrorResponse(error);
      if (res) return res;
      throw error;
    }
    try {
      // The handler's writes are attributed to the session (lib/audit/context.js).
      return await runAsActor(session, () => handler(req, { ...ctx, session, constraints }));
    } catch (error) {
      const res = authErrorResponse(error);
      if (res) return res;
      throw error;
    }
  };
}

/**
 * Wrap a route handler so it only runs when the permission is held.
 * The handler receives (req, ctx) with ctx.session and ctx.constraints added.
 */
export function guard(code, handler) {
  return async function guardedRoute(req, ctx = {}) {
    let session, constraints;
    try {
      ({ session, constraints } = await authorize(code));
    } catch (error) {
      const res = authErrorResponse(error);
      if (res) return res;
      throw error;
    }
    try {
      // The handler's writes are attributed to the session (lib/audit/context.js).
      return await runAsActor(session, () => handler(req, { ...ctx, session, constraints }));
    } catch (error) {
      const res = authErrorResponse(error);
      if (res) return res;
      throw error;
    }
  };
}
