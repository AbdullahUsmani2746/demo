import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// No dedicated role tier for this: whoever already has menu access to the
// account-management page (enforced by middleware/menu permissions) can see
// and toggle off accounts there. Here we only require an authenticated session.
export function canManageAccountVisibility(session) {
  return !!session?.user;
}

// Call from a route handler; returns { session, allowed }.
export async function getAccountVisibilitySession() {
  const session = await getServerSession(authOptions);
  return { session, allowed: canManageAccountVisibility(session) };
}
