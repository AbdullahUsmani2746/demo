"use client";
// The top bar of the ERP: menu button, apps, company, search, off-books switch,
// Approvals (approvers only — badge + soft blink while something waits for
// them), notifications and the signed-in person, whose menu also lists their
// personal pages (My HR, My Dashboards, BI Designer, … — QuickLinkMenuItems).
//
// Phone (< 640px): the apps icon folds into the company logo (which opens All
// applications) and the user menu; search is an icon; every button is 40px.
//
// Menu button: hover opens the sidebar for a moment (as before); a CLICK pins
// it open — remembered on this computer — and a second click unpins it. On a
// phone the click opens the menu as a sheet. Ctrl+B also toggles it.
// Alt+G opens All applications.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { signOutAndForgetDevice } from "@/lib/pwa/signOut";
import { toast } from "sonner";
import { ChevronDown, Eye, EyeOff, KeyRound, LayoutGrid, Loader2, Lock, LogOut, Menu, PanelLeftClose, Settings, User } from "lucide-react";

import { SearchForm } from "@/components/sidebar/search-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useSidebar } from "@/components/ui/sidebar";
import { useCompany } from "@/context/CompanyContext";
import NotificationBell from "../Notifications/NotificationBell";
import ApprovalsButton from "@/components/approvals/ApprovalsButton";
import QuickLinkMenuItems from "@/components/sidebar/QuickLinkMenuItems";
import { OffBooksButton, OffBooksProvider } from "@/components/sidebar/OffBooksSwitch";
import { accountLinks, initialsOf } from "@/components/sidebar/nav-user";
import { useRoles } from "@/hooks/useRoles";
const PIN_KEY = "sidebar_pinned";

const ICON_BTN =
  "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-primary-foreground transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";

function Brand({ href, children }) {
  const cls = "ml-1 flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 sm:ml-2";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-white/10`}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function PasswordField({ id, label, value, onChange, shown, onToggle, autoFocus }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          className="h-10 pr-10"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={shown ? "Hide password" : "Show password"}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export function SiteHeader({ employeeId, role }) {
  const { open, setOpen, isMobile, openMobile, setOpenMobile } = useSidebar();
  const { company } = useCompany();
  const { data: session } = useSession();
  const router = useRouter();
  const [isHoveringMenu, setIsHoveringMenu] = useState(false);
  const [isHoveringSidebar, setIsHoveringSidebar] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [cachedCompany, setCachedCompany] = useState(null);
  // Applications page: everyone signed in (it shows their own menus).
  const canApps = !!session?.user;
  const links = accountLinks(session?.user);
  const { roleName } = useRoles();

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Company: cached copy first, so the name shows before the query returns.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("company_data");
      if (stored) setCachedCompany(JSON.parse(stored));
      setPinned(localStorage.getItem(PIN_KEY) === "1");
    } catch {
      /* storage blocked — fine */
    }
  }, []);
  useEffect(() => {
    // useCompany() returns an empty placeholder until it loads — never cache that.
    if (company?.name) {
      try {
        localStorage.setItem("company_data", JSON.stringify(company));
      } catch {
        /* ignore */
      }
      setCachedCompany(company);
    }
  }, [company]);
  const displayCompany = company?.name ? company : cachedCompany;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  // Hover opens / closes the sidebar — unless it is pinned.
  useEffect(() => {
    if (pinned) {
      setOpen(true);
      return;
    }
    let t;
    if (isHoveringMenu || isHoveringSidebar) t = setTimeout(() => setOpen(true), 150);
    else t = setTimeout(() => setOpen(false), 300);
    return () => clearTimeout(t);
  }, [isHoveringMenu, isHoveringSidebar, pinned, setOpen]);

  // A click elsewhere closes an unpinned sidebar.
  useEffect(() => {
    const onClick = (e) => {
      if (pinned) return;
      const sidebar = document.querySelector('[data-sidebar="sidebar"]');
      const menuButton = document.querySelector('[data-menu-button="true"]');
      if (sidebar && !sidebar.contains(e.target) && menuButton && !menuButton.contains(e.target)) {
        setOpen(false);
        setIsHoveringMenu(false);
        setIsHoveringSidebar(false);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [pinned, setOpen]);

  useEffect(() => {
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    if (!sidebar) return;
    const enter = () => setIsHoveringSidebar(true);
    const leave = () => setIsHoveringSidebar(false);
    sidebar.addEventListener("mouseenter", enter);
    sidebar.addEventListener("mouseleave", leave);
    return () => {
      sidebar.removeEventListener("mouseenter", enter);
      sidebar.removeEventListener("mouseleave", leave);
    };
  }, []);

  // Alt+G → All applications.
  useEffect(() => {
    if (!canApps) return;
    const onKey = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        router.push("/accounting/apps");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canApps, router]);

  const onMenuClick = () => {
    if (isMobile) {
      setOpenMobile(!openMobile);
      return;
    }
    const next = !pinned;
    setPinned(next);
    setOpen(next);
    try {
      localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const closePassword = (o) => {
    setShowChangePassword(o);
    if (!o) {
      setOldPassword("");
      setNewPassword("");
      setShowOld(false);
      setShowNew(false);
    }
  };
  const changePassword = async () => {
    setIsChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) toast.error(data.error || "Could not change the password");
      else {
        toast.success("Password changed");
        closePassword(false);
      }
    } catch {
      toast.error("Something went wrong — try again");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const user = session?.user;
  const companyName = displayCompany?.name || "Company";

  return (
    <OffBooksProvider>
      <header className="sticky top-0 z-50 w-full border-b border-black/10 bg-primary shadow-sm print:hidden">
        <div className="flex h-[--header-height] w-full min-w-0 items-center gap-1 px-2 sm:gap-2 sm:px-4">
          {/* Menu */}
          <button
            type="button"
            data-menu-button="true"
            className={`${ICON_BTN} ${pinned && open ? "bg-white/15" : ""}`}
            onClick={onMenuClick}
            onMouseEnter={() => setIsHoveringMenu(true)}
            onMouseLeave={() => setIsHoveringMenu(false)}
            aria-label={pinned ? "Unpin the menu" : "Pin the menu open"}
            title={pinned ? "Unpin the menu (Ctrl+B)" : "Menu — click to keep it open (Ctrl+B)"}
          >
            {pinned && open ? <PanelLeftClose className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          {/* All applications — Alt+G */}
          {canApps && (
            <Link href="/accounting/apps" className={`${ICON_BTN} hidden sm:flex`} title="All applications (Alt+G)" aria-label="All applications" aria-keyshortcuts="Alt+G">
              <LayoutGrid className="h-5 w-5" />
            </Link>
          )}

          {/* Company (opens All applications for those who have it) */}
          <Brand href={canApps ? "/accounting/apps" : null}>
            {displayCompany?.logo ? (
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5">
                <img src={displayCompany.logo} alt="" className="h-full w-full object-contain" />
              </span>
            ) : (
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-sm font-bold text-white">
                {initialsOf(companyName)}
              </span>
            )}
            <span className="hidden truncate text-[17px] font-bold tracking-tight text-primary-foreground sm:block">{companyName}</span>
          </Brand>

          <div className="min-w-0 flex-1" />

          {/* Search (Ctrl+K) */}
          <SearchForm className="w-52 lg:w-72 xl:w-80" employeeId={employeeId} role={role} />

          <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
            {/* Hide off books — holders of offBooks.hide (lib/accounts/books.js) */}
            <OffBooksButton />
            {/* Approvals inbox — only for people who decide something */}
            <ApprovalsButton />
            <NotificationBell session={session} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 min-w-10 items-center gap-2 rounded-lg px-1 text-primary-foreground transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:px-2"
                  aria-label="Your account"
                >
                  <Avatar className="h-8 w-8 ring-2 ring-white/25">
                    <AvatarImage src={user?.image || undefined} />
                    <AvatarFallback className="bg-white/20 text-xs font-bold text-white">{initialsOf(user?.name)}</AvatarFallback>
                  </Avatar>
                  <span className="hidden flex-col items-start text-left leading-tight lg:flex">
                    <span className="max-w-[160px] truncate text-[13px] font-semibold">{user?.name || "User"}</span>
                    <span className="text-[11px] text-white/70">{getGreeting()}</span>
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 opacity-70 lg:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" collisionPadding={8} className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto rounded-xl">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-semibold">{user?.name || "User"}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                  {role && (
                    <span className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{roleName(role)}</span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* My HR, My Dashboards, BI Designer, Follow-ups, Audit Trail — each for whoever its page serves */}
                <QuickLinkMenuItems />
                {links.profile && (
                  <DropdownMenuItem asChild>
                    <Link href="/accounting/profile">
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                )}
                {links.settings && (
                  <DropdownMenuItem asChild>
                    <Link href="/accounting/settings">
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                )}
                {canApps && (
                  <DropdownMenuItem asChild>
                    <Link href="/accounting/apps">
                      <LayoutGrid className="mr-2 h-4 w-4" />
                      All applications
                      <span className="ml-auto text-[11px] text-muted-foreground">Alt+G</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowChangePassword(true)}>
                  <Lock className="mr-2 h-4 w-4" />
                  Change password
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => signOutAndForgetDevice({ callbackUrl: "/auth/signin" })}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Change password */}
      <Dialog open={showChangePassword} onOpenChange={closePassword}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-md">
          <div className="border-b border-primary/15 bg-primary/5 px-6 py-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white">
                  <KeyRound className="h-5 w-5" />
                </span>
                <div className="text-left">
                  <DialogTitle className="text-primary">Change password</DialogTitle>
                  <DialogDescription className="mt-0.5">Enter your current password and a new one.</DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (oldPassword && newPassword && !isChangingPassword) changePassword();
            }}
          >
            <div className="space-y-4 px-6 py-5">
              <PasswordField id="pw-old" label="Current password" value={oldPassword} onChange={setOldPassword} shown={showOld} onToggle={() => setShowOld((v) => !v)} autoFocus />
              <PasswordField id="pw-new" label="New password" value={newPassword} onChange={setNewPassword} shown={showNew} onToggle={() => setShowNew((v) => !v)} />
            </div>
            <DialogFooter className="gap-2 border-t border-border bg-muted/40 px-6 py-3">
              <Button type="button" variant="outline" onClick={() => closePassword(false)} disabled={isChangingPassword}>
                Cancel
              </Button>
              <Button type="submit" disabled={isChangingPassword || !oldPassword || !newPassword}>
                {isChangingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </OffBooksProvider>
  );
}
