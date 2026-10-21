import { useLayoutEffect, useRef } from "react";

/**
 * An <img> for a photo held as a Blob. The object URL is made when the Blob arrives and revoked when
 * it changes or the image goes, so no URL outlives what it shows.
 */
export function BlobImage({ blob, alt, className }: { blob: Blob; alt: string; className?: string }) {
  const img = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const element = img.current;
    if (!element) return;
    const url = URL.createObjectURL(blob);
    element.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={img} alt={alt} className={className} />;
}
