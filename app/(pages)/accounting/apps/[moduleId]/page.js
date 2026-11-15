import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveEmployeeId } from "@/lib/menu/sessionEmployee";
import ModuleView from "@/components/AppMenu/ModuleView";

export const metadata = {
  title: "Module",
  description: "Pages inside this module",
};

export default async function ModulePage({ params }) {
  const { moduleId } = await params;
  const session = await getServerSession(authOptions);
  const employeeId = await resolveEmployeeId(session);

  return (
    <ModuleView moduleId={moduleId} employeeId={employeeId} role={session?.user?.role} />
  );
}
