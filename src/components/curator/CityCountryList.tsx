"use client";

import { useState } from "react";
import { Button, Card, Flag } from "@/components/ui";
import { setCityCountryStatusAction } from "@/app/curator/actions";
import { useRun } from "./useRun";

export interface CityCountryRow {
  iso2: string;
  name: string;
  status: "unlisted" | "uncharted";
}

type Filter = "all" | "unlisted" | "uncharted";

export function CityCountryList({ rows, city }: { rows: CityCountryRow[]; city: string }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (filter === "all" || r.status === filter) && (!needle || r.name.toLowerCase().includes(needle) || r.iso2.toLowerCase() === needle),
  );
  const uncharted = rows.filter((r) => r.status === "uncharted").length;

  return (
    <>
      <Card tone="sunk" className="mb-4 text-sm text-ink-soft">
        <p>
          <strong className="text-ink">Unlisted</strong> means nobody has checked {city} yet.{" "}
          <strong className="text-ink">Uncharted</strong> is your assertion that {city} has no specialist for the country.
        </p>
        <p className="mt-2">
          A country with an eligible restaurant is listed and can&apos;t be marked uncharted. If a restaurant is
          approved later, an uncharted country flips back to unlisted and then listed by itself.
        </p>
      </Card>

      <label htmlFor="cc-q" className="sr-only">
        Find a country
      </label>
      <input
        id="cc-q"
        className="input mb-3"
        type="search"
        placeholder="Find a country"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
      <div className="mb-4 flex gap-2" role="group" aria-label="Filter by status">
        {(["all", "unlisted", "uncharted"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "primary" : "secondary"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? `All ${rows.length}` : f === "uncharted" ? `Uncharted ${uncharted}` : `Unlisted ${rows.length - uncharted}`}
          </Button>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {shown.map((r) => (
          <Row key={r.iso2} r={r} />
        ))}
        {shown.length === 0 && <li className="py-6 text-center text-sm text-muted">No countries match.</li>}
      </ul>
    </>
  );
}

function Row({ r }: { r: CityCountryRow }) {
  const t = useRun();
  const next = r.status === "uncharted" ? "unlisted" : "uncharted";
  return (
    <li>
      <Card className="flex items-center gap-3 py-2.5">
        <Flag iso2={r.iso2} size="md" label={r.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{r.name}</p>
          <p className="text-xs text-muted">{r.status === "uncharted" ? "Uncharted" : "Unlisted"}</p>
          {t.error && (
            <p role="alert" className="text-xs text-stamp-red">
              {t.error}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant={r.status === "uncharted" ? "secondary" : "ghost"}
          loading={t.pending}
          onClick={() => t.run(() => setCityCountryStatusAction(r.iso2, next))}
          aria-label={`${r.status === "uncharted" ? "Set unlisted" : "Mark uncharted"}: ${r.name}`}
        >
          {r.status === "uncharted" ? "Set unlisted" : "Mark uncharted"}
        </Button>
      </Card>
    </li>
  );
}
