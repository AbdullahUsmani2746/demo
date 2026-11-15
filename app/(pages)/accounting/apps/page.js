import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveEmployeeId } from "@/lib/menu/sessionEmployee";
import AppLauncher from "@/components/AppMenu/AppLauncher";

export const metadata = {
  title: "Applications",
  description: "All modules and pages",
};

export default async function AppsPage() {
  const session = await getServerSession(authOptions);
  const employeeId = await resolveEmployeeId(session);

  return <AppLauncher employeeId={employeeId} role={session?.user?.role} />;
}
