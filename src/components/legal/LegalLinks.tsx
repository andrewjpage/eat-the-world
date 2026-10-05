import Link from "next/link";

/** Privacy and Credits links for page footers (login, and anywhere else a footer is needed). */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <span className={className}>
      <Link href="/privacy" className="underline underline-offset-2">
        Privacy
      </Link>
      <span aria-hidden> · </span>
      <Link href="/credits" className="underline underline-offset-2">
        Credits
      </Link>
    </span>
  );
}
