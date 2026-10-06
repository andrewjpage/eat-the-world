"use client";

import Link from "next/link";
import { useState } from "react";
import { Eyebrow } from "@/components/ui/Card";
import { Flag } from "@/components/ui/Flag";
import type { GapCountry } from "./spin";

const COLLAPSED = 12;

/** Listed countries nobody in the group has eaten, as a flag grid; each flag opens its country page. */
export function GapGrid({ gaps }: { gaps: GapCountry[] }) {
  const [all, setAll] = useState(false);
  if (gaps.length === 0) return null;
  const shown = all ? gaps : gaps.slice(0, COLLAPSED);

  return (
    <section aria-labelledby="gaps-heading" data-testid="gaps">
      <Eyebrow id="gaps-heading" className="mb-2 px-1">
        Gaps · {gaps.length}
      </Eyebrow>
      <p className="mb-3 px-1 text-sm text-ink-soft">
        London has a specialist for each of these, and nobody in the group has been yet.
      </p>
      <ul className="grid grid-cols-4 gap-2">
        {shown.map((g) => (
          <li key={g.iso2}>
            <Link
              href={`/country/${g.iso2}`}
              prefetch={false}
              className="flex min-h-11 flex-col items-center gap-1 rounded-xl border border-line bg-paper-raised px-1 py-2 text-center active:scale-95 focus-visible:outline-2 focus-visible:outline-stamp-red"
            >
              <Flag iso2={g.iso2} size="lg" />
              <span className="line-clamp-2 text-[0.7rem] leading-tight text-ink-soft">{g.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      {gaps.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="mt-3 min-h-11 w-full text-center text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {all ? "Show fewer" : `Show all ${gaps.length}`}
        </button>
      )}
    </section>
  );
}
