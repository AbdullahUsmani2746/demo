// app/api/permissions/me/route.js
//
// What the signed-in user may do. The UI calls this once and hides buttons
// the user cannot use — convenience only; every route enforces its own
// permission server-side regardless of what the client believes.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { permissionCodesFor, hasFullAccess, fieldPolicyFor } from "@/lib/auth/permissions";
import { allScopes } from "@/lib/auth/scope";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (session.blocked) {
    return NextResponse.json(
      { error: "Session revoked", reason: session.blocked },
      { status: 401 },
    );
  }

  // ?entities=ACNO,SALES_ITEM_CUST — field policy for the screens being opened
  const { searchParams } = new URL(request.url);
  const entities = (searchParams.get("entities") || "").split(",").filter(Boolean);

  const [codes, scopes, ...policies] = await Promise.all([
    permissionCodesFor(session),
    allScopes(session),
    ...entities.map((e) => fieldPolicyFor(session, e)),
  ]);

  return NextResponse.json({
    userId: session.user.id,
    role: session.user.role,
    roles: session.user.roles ?? [session.user.role],
    fullAccess: hasFullAccess(session),
    permissions: [...codes],
    scopes,
    fieldPolicy: Object.fromEntries(entities.map((e, i) => [e, policies[i]])),
  });
}
