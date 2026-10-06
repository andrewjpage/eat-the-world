import { createClient } from "@/lib/supabase/server";
import { cn } from "@/components/ui/cn";
import { signPhotoUrl } from "./signed";

/**
 * The visit's photo at full width (server component). Signs a short-lived URL as the
 * signed-in user; renders nothing when the visit has no photo.
 */
export async function VisitPhoto({
  path,
  alt,
  className,
}: {
  path: string | null;
  alt: string;
  className?: string;
}) {
  if (!path) return null;
  const url = await signPhotoUrl(await createClient(), path);
  if (!url) return null;
  return (
    <figure className={cn("overflow-hidden rounded-3xl border border-line bg-paper-sunk", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} decoding="async" className="mx-auto block max-h-[26rem] w-full object-cover" />
    </figure>
  );
}

