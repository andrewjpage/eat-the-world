import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, safeNext } from "@/lib/app";
import { LoginForm } from "@/components/auth/LoginForm";
import { LogoMark } from "@/components/nav/TopBar";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Get a fresh code below.",
  oauth: "Google sign-in didn't finish. Please try again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null, "/");
  const errorKey = typeof sp.error === "string" ? sp.error : null;
  const joining = next.startsWith("/join/");

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {/* The passport cover */}
      <section
        aria-label={APP_NAME}
        className="relative overflow-hidden rounded-[1.75rem] bg-[#1f2a44] px-6 pt-8 pb-7 text-center text-[#e8c77a] shadow-[0_18px_40px_rgb(31_42_68/0.35)] dark:bg-[#0c1426]"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-2.5 rounded-[1.35rem] border border-[#e8c77a]/30"
        />
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.35em] text-[#e8c77a]/80">
          Passport · London
        </p>
        <LogoMark className="mx-auto my-5 size-24 text-[#e8c77a]" />
        <h1 className="font-display text-[2.6rem] leading-none font-semibold">{APP_NAME}</h1>
        <p className="mx-auto mt-3 max-w-[16rem] text-sm text-[#f1e9d8]/80">
          {joining
            ? "Your friends saved you a seat. Sign in to join the table."
            : "Eat your way around the world without leaving London."}
        </p>
      </section>

      <section className="mt-6 rounded-[1.75rem] border border-line bg-paper-raised p-5">
        <LoginForm next={next} initialError={errorKey ? (ERRORS[errorKey] ?? null) : null} />
      </section>

      <p className="mt-auto pt-6 text-center text-xs text-muted">
        Invite-only, no ads, no tracking.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy
        </Link>
      </p>
    </div>
  );
}
