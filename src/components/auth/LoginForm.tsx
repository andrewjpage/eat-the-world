"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/app";
import { Button } from "@/components/ui/Button";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true";
const RESEND_SECONDS = 30;

function friendlyAuthError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("rate limit") || m.includes("security purposes")) {
    return "Too many codes requested. Wait a minute, then try again.";
  }
  if (m.includes("expired") || m.includes("invalid") || m.includes("token")) {
    return "That code didn't work. Check the latest email, or send a new code.";
  }
  if (m.includes("email") && m.includes("valid")) return "That doesn't look like an email address.";
  if (m.includes("fetch") || m.includes("network")) return "No signal? We couldn't reach the server.";
  return message || "Something went wrong. Please try again.";
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.3-4.8 3.3-8.1Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z" />
    </svg>
  );
}

/**
 * Email one-time code sign-in (send code, then type the 6 digits), plus Google
 * when NEXT_PUBLIC_GOOGLE_AUTH is "true". Returns to `next` afterwards.
 */
export function LoginForm({ next, initialError }: { next: string; initialError?: string | null }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | "google" | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [cooldown, setCooldown] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  const target = safeNext(next, "/");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy("send");
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email: address,
      // The email's "tap here" link returns here too (templates use {{ .RedirectTo }}),
      // so an invitee who signs in from the email still joins the group.
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}${target}` },
    });
    setBusy(null);
    if (error) {
      setError(friendlyAuthError(error.message));
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(RESEND_SECONDS);
    window.setTimeout(() => codeInput.current?.focus(), 50);
  }

  async function verify(token: string) {
    if (busy === "verify") return;
    setBusy("verify");
    setError(null);
    const { error } = await createClient().auth.verifyOtp({
      email: email.trim(),
      token,
      type: "email",
    });
    if (error) {
      setBusy(null);
      setError(friendlyAuthError(error.message));
      setCode("");
      codeInput.current?.focus();
      return;
    }
    // A full navigation renders the target once, with the new session cookie
    // (a client replace + refresh would render it twice, e.g. joining twice).
    window.location.assign(target);
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  }

  async function google() {
    setBusy("google");
    setError(null);
    const redirectTo = `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(target)}`;
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setBusy(null);
      setError(friendlyAuthError(error.message));
    }
  }

  return (
    <div className="w-full">
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-stamp-red/30 bg-stamp-red-soft px-4 py-3 text-sm font-medium text-stamp-red"
        >
          {error}
        </p>
      )}

      {step === "email" ? (
        <>
          {GOOGLE_ENABLED && (
            <>
              <Button
                variant="secondary"
                size="lg"
                block
                onClick={google}
                loading={busy === "google"}
              >
                {busy !== "google" && <GoogleLogo />}
                Continue with Google
              </Button>
              <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                <span className="h-px flex-1 bg-line" />
                or get a code by email
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}
          <form onSubmit={sendCode} className="space-y-3">
            <label htmlFor="email" className="block text-sm font-semibold text-ink-soft">
              Your email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="you@example.com"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              type="submit"
              size="lg"
              block
              variant={GOOGLE_ENABLED ? "secondary" : "primary"}
              loading={busy === "send"}
            >
              Send me a code
            </Button>
          </form>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) void verify(code);
          }}
          className="space-y-3"
        >
          <p className="text-[0.95rem] text-ink-soft">
            We sent a 6-digit code to <strong className="text-ink">{email.trim()}</strong>.
          </p>
          <label htmlFor="code" className="sr-only">
            6-digit code
          </label>
          <input
            ref={codeInput}
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="••••••"
            className="input text-center font-mono text-3xl tracking-[0.5em]"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            disabled={busy === "verify"}
          />
          <Button
            type="submit"
            size="lg"
            block
            loading={busy === "verify"}
            disabled={code.length !== 6}
          >
            Open my passport
          </Button>
          <div className="flex items-center justify-between pt-1 text-sm">
            <button
              type="button"
              className="font-semibold text-ink-soft underline-offset-4 hover:underline"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
            >
              Use a different email
            </button>
            <button
              type="button"
              className="font-semibold text-stamp-red underline-offset-4 hover:underline disabled:text-muted disabled:no-underline"
              disabled={cooldown > 0 || busy === "send"}
              onClick={() => void sendCode()}
            >
              {cooldown > 0 ? `New code in ${cooldown}s` : "Send a new code"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
