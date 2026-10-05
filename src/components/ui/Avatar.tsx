import { cn } from "./cn";

const palette = ["bg-stamp-red", "bg-verified-teal", "bg-gold", "bg-ink"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = [...parts[0]][0] ?? "";
  const last = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Photo hosts that can't track viewers: Google profile photos and Supabase
 * Storage. Matches the profiles_avatar_url trigger
 * (supabase/migrations/20261005140000_avatar_url_hosts.sql).
 */
const SAFE_AVATAR = /^https:\/\/(lh[0-9]+\.googleusercontent\.com\/|[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/)/;

export function safeAvatarUrl(src: string | null | undefined): string | null {
  return src && SAFE_AVATAR.test(src) ? src : null;
}

/**
 * Initials in a coloured circle, or the profile photo if it is on a safe host.
 * Uses a plain <img>, never next/image (brief section 7).
 */
export function Avatar({
  name,
  src,
  size = 36,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  const photo = safeAvatarUrl(src);
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        referrerPolicy="no-referrer"
        className={cn("shrink-0 rounded-full object-cover ring-2 ring-paper-raised", className)}
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold text-paper-raised ring-2 ring-paper-raised",
        palette[hash(name) % palette.length],
        className,
      )}
      style={style}
    >
      {initials(name)}
    </span>
  );
}
