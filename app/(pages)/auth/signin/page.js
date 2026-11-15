"use client";
// Sign in. Left: the product and what it covers (hidden on a phone). Right:
// the sign-in card. "Forgot password?" runs the three steps of
// /api/auth/forgot-password → verify-otp → reset-password.

import { useState, useEffect, useRef } from "react";
import { signIn, getSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Boxes,
  Calculator,
  CheckCircle2,
  Eye,
  EyeOff,
  Factory,
  Loader2,
  Lock,
  Truck,
  User,
  Users,
  X,
} from "lucide-react";
import { homeFor } from "@/lib/client-helpers";

const MODULES = [
  { icon: Calculator, label: "Accounting", desc: "Vouchers, ledgers and period close" },
  { icon: Truck, label: "Sales & dispatch", desc: "Orders, dispatches and invoicing" },
  { icon: Boxes, label: "Inventory", desc: "GRN, transfers and stock" },
  { icon: Factory, label: "Production", desc: "BOMs, process orders and costing" },
  { icon: Users, label: "HR & payroll", desc: "Attendance, leave and salaries" },
  { icon: BarChart3, label: "Reports & dashboards", desc: "One report engine for every module" },
];

const STEPS = ["Your details", "Code", "New password"];

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15";

export default function SignIn() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("/");
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotPhone, setForgotPhone] = useState("");
  const [forgotStep, setForgotStep] = useState(1); // 1: details, 2: OTP, 3: new password
  const [otp, setOtp] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const identifierRef = useRef(null);

  const router = useRouter();

  useEffect(() => {
    const cb = new URLSearchParams(window.location.search).get("callbackUrl");
    if (cb) setCallbackUrl(cb);
    identifierRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email: identifier,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Wrong username / email or password.");
      } else {
        const session = await getSession();
        // A dashboard assigned as this person's landing page (BI Designer →
        // Dashboards → Assign) opens first; otherwise the usual role page.
        let landing = null;
        try {
          const r = await fetch("/api/bi/my");
          if (r.ok) landing = (await r.json()).data?.find((d) => d.is_landing) ?? null;
        } catch {
          landing = null;
        }
        if (landing) {
          router.push(`/dashboard/insights?id=${landing.id}`);
        } else if (session?.user?.role) {
          router.push(homeFor(session.user));
        } else {
          router.push(callbackUrl);
        }
      }
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForgot = () => {
    setForgotStep(1);
    setForgotUsername("");
    setForgotEmail("");
    setForgotPhone("");
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setForgotError("");
    setForgotSuccess("");
  };
  const closeForgot = () => {
    setIsForgotModalOpen(false);
    resetForgot();
  };

  useEffect(() => {
    if (!isForgotModalOpen) return;
    const onKey = (e) => e.key === "Escape" && !isForgotLoading && closeForgot();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setForgotError("");
    setForgotSuccess("");
    setIsForgotLoading(true);

    try {
      if (forgotStep === 1) {
        // Step 1: send the details, receive an OTP by email
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: forgotUsername,
            email: forgotEmail,
            phone: forgotPhone,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setForgotError(data.error || "Could not send the code");
        } else {
          setForgotSuccess(data.message);
          setForgotStep(2);
        }
      } else if (forgotStep === 2) {
        // Step 2: verify the OTP
        const res = await fetch("/api/auth/verify-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: forgotEmail, otp }),
        });
        const data = await res.json();
        if (!res.ok) {
          setForgotError(data.error || "That code is not right");
        } else {
          setForgotSuccess("Code verified — choose a new password.");
          setForgotStep(3);
        }
      } else if (forgotStep === 3) {
        // Step 3: set the new password
        if (!newPassword || !confirmPassword) {
          setForgotError("Fill in both password fields.");
          setIsForgotLoading(false);
          return;
        }
        if (newPassword !== confirmPassword) {
          setForgotError("The two passwords are not the same.");
          setIsForgotLoading(false);
          return;
        }
        const resetRes = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: forgotEmail, otp, newPassword }),
        });
        const resetData = await resetRes.json();
        if (!resetRes.ok) {
          setForgotError(resetData.error || "Could not reset the password.");
        } else {
          setForgotSuccess(resetData.message || "Password changed — you can sign in now.");
          setTimeout(closeForgot, 3000);
        }
      }
    } catch {
      setForgotError("Something went wrong — please try again.");
    } finally {
      setIsForgotLoading(false);
    }
  };

  const capsCheck = (e) => setCapsLock(Boolean(e.getModifierState?.("CapsLock")));

  return (
    <div className="flex min-h-screen bg-muted/40">
      {/* ── Brand panel ── */}
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#800000] to-[#4a0000] p-10 text-white lg:flex xl:p-14">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full border border-white/10" aria-hidden="true" />

        <div className="relative flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white p-1.5 shadow-lg">
            <Image src="/ebiz-logo.png" alt="" width={40} height={40} />
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight">BIZ LOGIST</p>
            <p className="text-xs text-white/70">Enterprise business management</p>
          </div>
        </div>

        <div className="relative">
          <h1 className="max-w-md text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
            Your whole business, in one place.
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75">
            Accounts, sales, stock, production and people — every module posting to the same books.
          </p>
          <ul className="mt-8 grid max-w-lg grid-cols-2 gap-3">
            {MODULES.map(({ icon: Icon, label, desc }) => (
              <li key={label} className="flex items-start gap-3 rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-[11.5px] leading-snug text-white/65">{desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/55">© {new Date().getFullYear()} BIZ LOGIST</p>
      </aside>

      {/* ── Sign in ── */}
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          {/* Brand on a phone / tablet */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1.5 shadow ring-1 ring-border">
              <Image src="/ebiz-logo.png" alt="" width={36} height={36} />
            </span>
            <div>
              <p className="text-lg font-bold tracking-tight text-foreground">BIZ LOGIST</p>
              <p className="text-xs text-muted-foreground">Enterprise business management</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-6 shadow-xl shadow-black/[0.04] sm:p-8">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Welcome back — enter your details to continue.</p>

            {error && (
              <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm font-medium text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="identifier" className="mb-1.5 block text-[13px] font-semibold text-foreground/85">
                  Username or email
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="identifier"
                    ref={identifierRef}
                    type="text"
                    autoComplete="username"
                    placeholder="e.g. ahmed or ahmed@company.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    className={`${inputCls} pl-10`}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="password" className="block text-[13px] font-semibold text-foreground/85">
                    Password
                  </label>
                  <button type="button" onClick={() => setIsForgotModalOpen(true)} className="text-[13px] font-semibold text-primary hover:underline">
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={capsCheck}
                    onKeyDown={capsCheck}
                    onBlur={() => setCapsLock(false)}
                    required
                    className={`${inputCls} pl-10 pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {capsLock && <p className="mt-1.5 text-xs font-medium text-[#5f4b1f]">Caps Lock is on.</p>}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 border-t border-border pt-5 text-center text-[13px] text-muted-foreground">
              No account yet? Ask your system administrator to create one.
            </p>
          </div>
        </div>
      </main>

      {/* ── Forgot password ── */}
      {isForgotModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && !isForgotLoading && closeForgot()}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="forgot-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-primary/15 bg-primary/5 px-6 py-4">
              <div>
                <h3 id="forgot-title" className="text-lg font-bold text-primary">
                  Reset your password
                </h3>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {forgotStep === 1
                    ? "Enter your details — we email you a 6-digit code."
                    : forgotStep === 2
                      ? `Enter the code we sent to ${forgotEmail || "your email"}.`
                      : "Choose a new password."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeForgot}
                disabled={isForgotLoading}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Steps */}
            <ol className="flex items-center gap-2 px-6 pt-4" aria-label="Steps">
              {STEPS.map((s, i) => {
                const n = i + 1;
                const done = forgotStep > n;
                const on = forgotStep === n;
                return (
                  <li key={s} className="flex flex-1 items-center gap-2">
                    <span
                      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        done ? "bg-[#2f5139] text-white" : on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
                    </span>
                    <span className={`hidden truncate text-xs sm:block ${on ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{s}</span>
                    {n < STEPS.length && <span className="h-px flex-1 bg-border" />}
                  </li>
                );
              })}
            </ol>

            <form onSubmit={handleForgotSubmit} className="space-y-4 px-6 pb-6 pt-4">
              {forgotError && (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                  {forgotError}
                </p>
              )}
              {forgotSuccess && (
                <p className="rounded-lg bg-[#edf2ee] px-3 py-2 text-sm font-medium text-[#2f5139]">{forgotSuccess}</p>
              )}

              {forgotStep === 1 ? (
                <>
                  <div>
                    <label htmlFor="fp-user" className="mb-1.5 block text-[13px] font-semibold text-foreground/85">Username</label>
                    <input id="fp-user" type="text" autoComplete="username" required autoFocus value={forgotUsername} onChange={(e) => setForgotUsername(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="fp-email" className="mb-1.5 block text-[13px] font-semibold text-foreground/85">Email</label>
                    <input id="fp-email" type="email" autoComplete="email" required value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="fp-phone" className="mb-1.5 block text-[13px] font-semibold text-foreground/85">Phone number</label>
                    <input id="fp-phone" type="tel" autoComplete="tel" required value={forgotPhone} onChange={(e) => setForgotPhone(e.target.value)} className={inputCls} />
                  </div>
                </>
              ) : forgotStep === 2 ? (
                <div>
                  <label htmlFor="fp-otp" className="mb-1.5 block text-[13px] font-semibold text-foreground/85">6-digit code</label>
                  <input
                    id="fp-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    maxLength={6}
                    placeholder="••••••"
                    className={`${inputCls} text-center font-mono text-xl tracking-[0.5em]`}
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="fp-new" className="mb-1.5 block text-[13px] font-semibold text-foreground/85">New password</label>
                    <div className="relative">
                      <input
                        id="fp-new"
                        type={showNewPassword ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        autoFocus
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className={`${inputCls} pr-11`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        aria-label={showNewPassword ? "Hide password" : "Show password"}
                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="fp-confirm" className="mb-1.5 block text-[13px] font-semibold text-foreground/85">Confirm new password</label>
                    <input id="fp-confirm" type="password" autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} />
                    {confirmPassword && newPassword !== confirmPassword && (
                      <p className="mt-1.5 text-xs font-medium text-destructive">The two passwords are not the same.</p>
                    )}
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-1">
                {forgotStep === 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      setForgotStep(1);
                      setForgotError("");
                      setForgotSuccess("");
                    }}
                    disabled={isForgotLoading}
                    className="flex h-11 items-center gap-1.5 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground hover:border-primary hover:text-primary"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isForgotLoading}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isForgotLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {forgotStep === 1 ? "Send code" : forgotStep === 2 ? "Verify code" : "Set new password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
