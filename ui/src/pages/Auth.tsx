import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { CloudSignIn } from "@/components/CloudSignIn";
import { clearCloudSignInAttempt } from "@/lib/cloud-sign-in";
import { tenantSignInReturnPath } from "@/lib/cloudLinks";
import { queryKeys } from "../lib/queryKeys";
import { getRememberedInvitePath } from "../lib/invite-memory";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { PaperclipLoading } from "@/components/AnimatedPaperclipIcon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PaperclipLockup } from "../components/PaperclipLockup";

type AuthMode = "sign_in" | "sign_up" | "forgot_password" | "reset_password";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Better Auth's reset callback redirects here with `?token=` (or
  // `?error=INVALID_TOKEN` for an expired/unknown token).
  const resetToken = searchParams.get("token");
  const resetTokenError = searchParams.get("error") === "INVALID_TOKEN";
  const [mode, setMode] = useState<AuthMode>(resetToken ? "reset_password" : "sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    resetTokenError ? "This password reset link is invalid or has expired." : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const errorId = "auth-error";

  const nextPath = useMemo(
    () => tenantSignInReturnPath(searchParams.get("next") || getRememberedInvitePath() || "/"),
    [searchParams],
  );
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const { data: session, isLoading: isSessionLoading, error: sessionError } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session && mode !== "reset_password") {
      clearCloudSignInAttempt();
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath, mode]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }
      if (mode === "forgot_password") {
        // Same-origin `/auth` only; Better Auth also checks it against trustedOrigins.
        await authApi.requestPasswordReset({ email: email.trim(), redirectTo: "/auth" });
        return;
      }
      if (mode === "reset_password") {
        await authApi.resetPassword({ newPassword: password, token: resetToken ?? "" });
        return;
      }
      await authApi.signUpEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });
    },
    onSuccess: async () => {
      setError(null);
      if (mode === "forgot_password") {
        setNotice("If that account exists, a reset link has been written to the server log. Ask your instance operator for it.");
        return;
      }
      if (mode === "reset_password") {
        setPassword("");
        setMode("sign_in");
        setNotice("Password updated. Sign in with your new password.");
        navigate("/auth", { replace: true });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.health });
      // Reset rather than invalidate: the `["companies"]` entry is shared app-wide and
      // is not account-scoped, so invalidating leaves the previous account's list
      // readable (and any fetch for that session in flight) until the refetch lands.
      // Sign-in can change accounts, so drop the list outright.
      await queryClient.resetQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Authentication failed");
    },
  });

  const canSubmit =
    mode === "forgot_password"
      ? email.trim().length > 0
      : mode === "reset_password"
        ? Boolean(resetToken) && password.trim().length >= 8
        : email.trim().length > 0 &&
          password.trim().length > 0 &&
          (mode === "sign_in" || (name.trim().length > 0 && password.trim().length >= 8));

  if (healthQuery.isLoading || isSessionLoading || (session && mode !== "reset_password")) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <PaperclipLoading className="min-h-0" />
      </div>
    );
  }

  // A health/session failure must not be mistaken for a self-hosted instance.
  if (healthQuery.error || sessionError) {
    return <p role="alert" className="p-6 text-sm text-destructive">Unable to check sign-in. Refresh and try again.</p>;
  }

  if (healthQuery.data?.cloud) {
    return <CloudSignIn cloud={healthQuery.data.cloud} returnTo={nextPath} />;
  }

  return (
    <div className="fixed inset-0 flex bg-background">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      {/* Left half — form */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="mb-8">
            <PaperclipLockup className="h-5 w-auto" />
          </div>

          <h1 className="text-xl font-semibold">
            {mode === "sign_in"
              ? "Sign in to Paperclip"
              : mode === "sign_up"
                ? "Create your Paperclip account"
                : mode === "forgot_password"
                  ? "Reset your password"
                  : "Choose a new password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "sign_in"
              ? "Use your email and password to access this instance."
              : mode === "sign_up"
                ? "Create an account for this instance. Email confirmation is not required in v1."
                : mode === "forgot_password"
                  ? "Enter your email. The reset link is written to the server log for the instance operator."
                  : "Enter a new password of at least 8 characters."}
          </p>
          {notice && (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              {notice}
            </p>
          )}

          <form
            className="mt-6 space-y-4"
            method="post"
            action={
              mode === "sign_up"
                ? "/api/auth/sign-up/email"
                : mode === "sign_in"
                  ? "/api/auth/sign-in/email"
                  : undefined
            }
            onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending) return;
              if (!canSubmit) {
                setError("Please fill in all required fields.");
                return;
              }
              mutation.mutate();
            }}
          >
            {mode === "sign_up" && (
              <div>
                <label htmlFor="name" className="text-xs text-muted-foreground mb-1 block">Name</label>
                <input
                  id="name"
                  name="name"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  aria-required="true"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  autoFocus
                />
              </div>
            )}
            {mode !== "reset_password" && (
            <div>
              <label htmlFor="email" className="text-xs text-muted-foreground mb-1 block">Email</label>
              <input
                id="email"
                name="email"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                autoFocus={mode === "sign_in" || mode === "forgot_password"}
              />
            </div>
            )}
            {mode !== "forgot_password" && (
            <div>
              <label htmlFor="password" className="text-xs text-muted-foreground mb-1 block">Password</label>
              <input
                id="password"
                name="password"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                autoFocus={mode === "reset_password"}
              />
            </div>
            )}
            {error && (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={mutation.isPending}
              aria-disabled={!canSubmit || mutation.isPending}
              className={`w-full ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
            >
              {mutation.isPending
                ? "Working…"
                : mode === "sign_in"
                  ? "Sign In"
                  : mode === "sign_up"
                    ? "Create Account"
                    : mode === "forgot_password"
                      ? "Request Reset Link"
                      : "Set New Password"}
            </Button>
          </form>

          {mode === "sign_in" && (
            <button
              type="button"
              className="mt-3 text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => {
                setError(null);
                setNotice(null);
                setMode("forgot_password");
              }}
            >
              Forgot password?
            </button>
          )}

          <div className="mt-5 text-sm text-muted-foreground">
            {mode === "sign_in" ? "Need an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => {
                setError(null);
                setNotice(null);
                setMode(mode === "sign_in" ? "sign_up" : "sign_in");
              }}
            >
              {mode === "sign_in" ? "Create one" : "Sign in"}
            </button>
          </div>
        </div>
      </div>

      {/* Right half — ASCII art animation (hidden on mobile) */}
      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </div>
  );
}
