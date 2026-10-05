"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Flag } from "@/components/ui/Flag";
import {
  groupStates,
  mineStates,
  summarise,
  type CountryState,
  type WorldCountry,
  type WorldData,
  type WorldState,
} from "./states";

/** Leaflet touches `window`; the map (and the atlas inside it) loads only on /world, never on the server. */
const WorldMap = dynamic(() => import("./WorldMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-paper-sunk text-sm font-semibold text-muted">
      Spinning up the globe…
    </div>
  ),
});

function Swatch({ kind }: { kind: "stamped" | "backfilled" | "listed" | "dot" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 align-middle",
        kind === "stamped" && "size-3.5 rounded-[3px] bg-stamp-red",
        kind === "backfilled" && "size-3.5 rounded-[3px] bg-gold/60",
        kind === "listed" && "size-3.5 rounded-[3px] border-[1.5px] border-ink-soft bg-paper-raised",
        kind === "dot" && "size-2.5 rounded-full border border-ink-soft bg-line",
      )}
    />
  );
}

function Stat({ swatch, n, children }: { swatch: "stamped" | "backfilled" | "listed"; n: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <Swatch kind={swatch} />
      <span>
        <b className="font-display text-lg leading-none text-ink">{n}</b>{" "}
        <span className="text-ink-soft">{children}</span>
      </span>
    </li>
  );
}

const CHIP: Record<Exclude<WorldState, "neutral">, string> = {
  stamped: "border-stamp-red/40 bg-stamp-red-soft text-ink",
  backfilled: "border-gold/40 bg-gold-soft text-ink",
  listed: "border-dashed border-ink-soft/50 bg-paper-raised text-ink",
};

/** The same colouring as the map, as tappable flags: the way in for tiny countries and screen readers. */
function ChipList({
  title,
  state,
  countries,
  states,
}: {
  title: string;
  state: Exclude<WorldState, "neutral">;
  countries: WorldCountry[];
  states: ReadonlyMap<string, CountryState>;
}) {
  const list = countries
    .filter((c) => states.get(c.iso2)?.state === state)
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  if (list.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-2 flex items-baseline gap-2 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-muted">
        {title} <span className="font-mono tracking-normal">{list.length}</span>
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {list.map((c) => (
          <li key={c.iso2}>
            <Link
              href={`/country/${c.iso2}`}
              prefetch={false}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border py-1 pr-3 pl-1.5 text-sm font-semibold transition active:scale-95",
                CHIP[state],
              )}
            >
              <Flag iso2={c.iso2} size="xs" />
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** My stamps, or a group's combined stamps, on the world map (brief section 6.3). */
export function WorldView({ data }: { data: WorldData }) {
  const [mode, setMode] = useState<"mine" | "group">("mine");
  const [groupId, setGroupId] = useState(data.groups[0]?.id ?? "");
  const group = data.groups.find((g) => g.id === groupId) ?? data.groups[0];

  const listed = useMemo(() => new Set(data.listed), [data.listed]);
  const states = useMemo(() => {
    const iso2s = data.countries.map((c) => c.iso2);
    if (mode === "group" && group) {
      return groupStates({ iso2s, listed, counts: group.counts, members: group.members });
    }
    return mineStates({
      iso2s,
      listed,
      visitStamped: new Set(data.visitStamped),
      backfilled: new Set(data.backfilled),
    });
  }, [mode, group, listed, data.countries, data.visitStamped, data.backfilled]);
  const sum = useMemo(() => summarise(states, listed), [states, listed]);
  const showingGroup = mode === "group" && !!group;
  const noStamps = data.visitStamped.length === 0 && data.backfilled.length === 0;

  return (
    <div className="pb-8">
      <div className="border-b border-line bg-paper-raised/90 px-4 pt-3 pb-3">
        <div className="mx-auto max-w-md space-y-2.5">
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Whose stamps" className="flex rounded-full bg-paper-sunk p-1 text-sm font-semibold">
              {(["mine", "group"] as const).map((m) => {
                const disabled = m === "group" && data.groups.length === 0;
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "min-h-9 rounded-full px-4 transition",
                      mode === m ? "bg-stamp-red text-on-stamp-red shadow-sm" : "text-ink-soft",
                      disabled && "opacity-45",
                    )}
                  >
                    {m === "mine" ? "My stamps" : "My group"}
                  </button>
                );
              })}
            </div>
            {mode === "group" && data.groups.length > 1 && (
              <select
                aria-label="Group"
                value={group?.id ?? ""}
                onChange={(e) => setGroupId(e.target.value)}
                className="input min-w-0 flex-1 !min-h-11 !py-1.5 text-sm"
              >
                {data.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            {showingGroup && data.groups.length === 1 && (
              <p className="min-w-0 truncate text-sm font-semibold text-ink">{group.name}</p>
            )}
          </div>

          <ul aria-label="Counts" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Stat swatch="stamped" n={sum.stamped}>
              {showingGroup ? (sum.stamped === 1 ? "country as a table" : "countries as a table") : "stamped"}
            </Stat>
            {!showingGroup && sum.backfilled > 0 && (
              <Stat swatch="backfilled" n={sum.backfilled}>
                before the app
              </Stat>
            )}
            <Stat swatch="listed" n={sum.toGo}>
              to go in London
            </Stat>
          </ul>
          <p className="text-xs text-muted">
            {showingGroup
              ? `Darker red means more of the table has eaten there. London lists ${sum.listed}. `
              : noStamps
                ? `No stamps yet. London lists ${sum.listed} countries, outlined here: go and colour one in. `
                : `London lists ${sum.listed}. `}
            <Swatch kind="dot" /> A dot marks a country too small to see. Tap any country to open it.
          </p>
        </div>
      </div>
      {/* The Mercator world is about twice as wide as tall, so the map is a banner, not full height. */}
      <div className="mx-auto h-[20rem] max-w-3xl border-b border-line">
        <WorldMap countries={data.countries} states={states} />
      </div>
      <div className="mx-auto max-w-md space-y-5 px-4 pt-5">
        <ChipList
          title={showingGroup ? "Eaten as a table" : "Stamped"}
          state="stamped"
          countries={data.countries}
          states={states}
        />
        {!showingGroup && (
          <ChipList title="Before the app" state="backfilled" countries={data.countries} states={states} />
        )}
        <ChipList
          title={showingGroup ? "Gaps: nobody has these yet" : "To go in London"}
          state="listed"
          countries={data.countries}
          states={states}
        />
      </div>
    </div>
  );
}
