// /unauthorized — where middleware.js sends a person whose roles / menus do
// not open the page they asked for. It used to be missing (a bare 404).
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export const metadata = { title: "No access" };

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
          <ShieldAlert className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">You do not have access to this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your roles or menus do not open it. Ask an administrator to give you the menu (Employee menus) or the right (Admin → Permissions).
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/dashboard" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Go to my home
          </Link>
        </div>
      </div>
    </main>
  );
}
