import { cn } from "./cn";

/** A pulsing placeholder block for loading.tsx screens. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-2xl bg-paper-sunk", className)} />;
}

/** Generic page skeleton: a heading, a line of copy and a few cards. */
export function PageSkeleton({ label, flag }: { label: string; flag?: boolean }) {
  return (
    <div role="status" className="mx-auto w-full max-w-md px-4 pt-4 pb-6">
      <span className="sr-only">{label}</span>
      <div className="mb-5 flex items-center gap-4">
        {flag && <Skeleton className="h-14 w-20 shrink-0 rounded-lg" />}
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-3/4 rounded-lg" />
          <Skeleton className="h-5 w-1/3 rounded-full" />
        </div>
      </div>
      <Skeleton className="mb-6 h-4 w-full rounded-full" />
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}
