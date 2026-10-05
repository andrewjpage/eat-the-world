import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { regionRank } from "@/lib/countries";
import { Stamp, type StampState } from "@/components/ui/Stamp";
import type { PassportCountry } from "./data";

export type PassportFilter = "all" | "listed" | "stamped";

const FILTERS: { id: PassportFilter; label: string; href: string }[] = [
  { id: "all", label: "All", href: "/" },
  { id: "listed", label: "Listed", href: "/?show=listed" },
  { id: "stamped", label: "Stamped", href: "/?show=stamped" },
];

const STATE_RANK: Record<StampState, number> = {
  stamped: 0,
  backfilled: 1,
  listed: 2,
  unlisted: 3,
  uncharted: 4,
};

export function parseFilter(v: string | string[] | undefined): PassportFilter {
  return v === "listed" || v === "stamped" ? v : "all";
}

function matches(c: PassportCountry, f: PassportFilter) {
  if (f === "listed") return c.state === "listed" || c.state === "stamped";
  if (f === "stamped") return c.state === "stamped" || c.state === "backfilled";
  return true;
}

function Cell({ c }: { c: PassportCountry }) {
  return (
    <Link
      href={`/country/${c.iso2}`}
      prefetch={false}
      className="block rounded-xl active:scale-95 focus-visible:outline-2 focus-visible:outline-stamp-red"
    >
      <Stamp
        iso2={c.iso2}
        name={c.name}
        state={c.state}
        date={c.date}
        verification={c.verification}
      />
    </Link>
  );
}

function Section({
  title,
  note,
  countries,
}: {
  title: string;
  note?: string;
  countries: PassportCountry[];
}) {
  const stamped = countries.filter((c) => c.state === "stamped" || c.state === "backfilled").length;
  return (
    <section
      className="mb-6 [contain-intrinsic-size:auto_420px] [content-visibility:auto]"
      aria-label={title}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-line pb-1">
        <h2 className="font-display text-lg text-ink">{title}</h2>
        <span className="font-mono text-xs text-muted">
          {stamped > 0 ? `${stamped} / ` : ""}
          {countries.length}
        </span>
      </div>
      {note && <p className="mb-2 text-xs text-muted">{note}</p>}
      <div className="grid grid-cols-3 gap-1">
        {countries.map((c) => (
          <Cell key={c.iso2} c={c} />
        ))}
      </div>
    </section>
  );
}

/** Filter chips plus the region-grouped flag grid. Pure server markup; filters are links. */
export function FlagGrid({
  countries,
  filter,
}: {
  countries: PassportCountry[];
  filter: PassportFilter;
}) {
  const charted = countries.filter((c) => c.state !== "uncharted" && matches(c, filter));
  const uncharted = filter === "all" ? countries.filter((c) => c.state === "uncharted") : [];

  const byRegion = new Map<string, PassportCountry[]>();
  for (const c of charted) {
    if (!byRegion.has(c.region)) byRegion.set(c.region, []);
    byRegion.get(c.region)!.push(c);
  }
  // Regions where the player has something (stamps, memories, listed places) come
  // first, so their own stamps sit above the fold; then west to east.
  const score = (list: PassportCountry[]) => list.filter((c) => c.state !== "unlisted").length;
  const regions = [...byRegion.entries()]
    .sort(
      ([a, la], [b, lb]) =>
        score(lb) - score(la) || regionRank(a) - regionRank(b) || a.localeCompare(b),
    )
    .map(([region, list]) => ({
      region,
      list: [...list].sort(
        (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name),
      ),
    }));

  return (
    <div>
      <nav aria-label="Filter countries" className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 mb-4 bg-paper/95 px-4 py-2 backdrop-blur">
        <ul className="flex gap-2">
          {FILTERS.map((f) => (
            <li key={f.id}>
              <Link
                href={f.href}
                replace
                scroll={false}
                aria-current={f.id === filter ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold",
                  f.id === filter
                    ? "border-stamp-red bg-stamp-red text-on-stamp-red"
                    : "border-line bg-paper-raised text-ink-soft",
                )}
              >
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Legend />

      {regions.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">Nothing here yet. Go and eat something.</p>
      )}
      {regions.map((r) => (
        <Section key={r.region} title={r.region} countries={r.list} />
      ))}
      {uncharted.length > 0 && (
        <Section
          title="Uncharted"
          note="London can't give you these yet. No specialist found."
          countries={[...uncharted].sort((a, b) => a.name.localeCompare(b.name))}
        />
      )}
    </div>
  );
}

function Legend() {
  const items = [
    ["Stamped", "bg-stamp-red"],
    ["Before the app", "border-2 border-dotted border-[#8a6d3b] dark:border-[#c9a86a]"],
    ["Listed in London", "border border-dashed border-ink/50"],
  ] as const;
  return (
    <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
      {items.map(([label, cls]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", cls)} />
          {label}
        </li>
      ))}
    </ul>
  );
}
