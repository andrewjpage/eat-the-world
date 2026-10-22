import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

/**
 * Stands in for `next/dynamic`: `React.lazy` inside `Suspense`, with `loading` as the fallback.
 * `ssr` is accepted for compatibility; there is no server here.
 */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  options: { ssr?: boolean; loading?: () => ReactNode } = {},
): ComponentType<P> {
  const Lazy = lazy(loader);

  return function Dynamic(props: P) {
    return (
      <Suspense fallback={options.loading?.() ?? null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
