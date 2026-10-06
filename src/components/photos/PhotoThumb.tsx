import { cn } from "@/components/ui/cn";

const SIZES = { sm: "size-14", md: "size-20", lg: "size-28" } as const;

/**
 * A small square photo, for the feed and lists. Takes an already signed URL (see
 * signPhotoUrls in ./signed, one call per page) so it works in server and client
 * components alike. A plain <img>, never next/image: the photos are already resized and
 * the signed URL is private. With no URL it shows a quiet placeholder.
 */
export function PhotoThumb({
  url,
  alt,
  size = "sm",
  className,
}: {
  url: string | null | undefined;
  alt: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const box = cn("shrink-0 overflow-hidden rounded-xl border border-line bg-paper-sunk", SIZES[size], className);
  if (!url) {
    return (
      <span aria-hidden className={cn(box, "flex items-center justify-center text-xl text-muted")}>
        📷
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} loading="lazy" decoding="async" className={cn(box, "object-cover")} />
  );
}
