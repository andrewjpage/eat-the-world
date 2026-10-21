import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { toHref } from "./navigation";

/** Stands in for `next/link`: a plain anchor pointing at a hash route. */
export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  /** Next.js hints. They mean nothing for a hash link, and must not reach the DOM. */
  prefetch?: boolean;
  scroll?: boolean;
  /** Swap the current history entry instead of adding one. */
  replace?: boolean;
};

export default function Link({
  href,
  replace,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  prefetch,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scroll,
  onClick,
  ...anchor
}: LinkProps) {
  const target = toHref(href);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    const plainClick =
      event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
    if (replace && target.startsWith("#") && plainClick && !event.defaultPrevented) {
      event.preventDefault();
      window.location.replace(target);
    }
  }

  return <a {...anchor} href={target} onClick={handleClick} />;
}
