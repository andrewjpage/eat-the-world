"use client";

import { useState } from "react";
import { BottomSheet, Button, Card, EmptyState, Flag } from "@/components/ui";
import { saveSetAction } from "@/app/curator/actions";
import { useRun } from "./useRun";
import type { CountryOption } from "./logic";

export interface SetRow {
  id: string;
  name: string;
  slug: string;
  countries: string[];
}


export function SetsEditor({ sets, countries }: { sets: SetRow[]; countries: CountryOption[] }) {
  // null = closed, "new" = add, otherwise the set being edited.
  const [editing, setEditing] = useState<SetRow | "new" | null>(null);
  const nameOf = (iso: string) => countries.find((c) => c.iso2 === iso)?.name ?? iso;

  return (
    <>
      <Button block className="mb-4" onClick={() => setEditing("new")}>
        Add a set
      </Button>
      {sets.length === 0 ? (
        <EmptyState emoji="🧩" title="No sets yet" className="py-6">
          A set is a group of countries. Completing one earns 25 points.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {sets.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setEditing(s)} className="block w-full text-left">
                <Card className="transition active:scale-[0.99]">
                  <p className="font-semibold text-ink">{s.name}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.countries.map((c) => (
                      <Flag key={c} iso2={c} size="sm" label={nameOf(c)} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted">{s.countries.length} countries</p>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <SetSheet
          key={editing === "new" ? "new" : editing.id}
          set={editing === "new" ? null : editing}
          countries={countries}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function SetSheet({
  set,
  countries,
  onClose,
}: {
  set: SetRow | null;
  countries: CountryOption[];
  onClose: () => void;
}) {
  const save = useRun();
  const [name, setName] = useState(set?.name ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(set?.countries ?? []));
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const visible = countries.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.iso2.toLowerCase() === needle);

  function toggle(iso: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(iso)) n.delete(iso);
      else n.add(iso);
      return n;
    });
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={set ? "Edit set" : "Add a set"}
      footer={
        <Button
          block
          size="lg"
          loading={save.pending}
          onClick={() => save.run(() => saveSetAction({ id: set?.id ?? null, name, countries: [...picked] }), onClose)}
        >
          {set ? "Save set" : "Add set"}
        </Button>
      }
    >
      <label htmlFor="set-name" className="mb-1 block text-sm font-semibold text-ink">
        Name
      </label>
      <input id="set-name" className="input mb-4" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="set-q" className="mb-1 block text-sm font-semibold text-ink">
        Countries <span className="font-normal text-muted">{picked.size} picked</span>
      </label>
      <input
        id="set-q"
        className="input mb-2"
        type="search"
        placeholder="Find a country"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
      <ul className="max-h-64 overflow-y-auto rounded-xl border border-line">
        {visible.map((c) => (
          <li key={c.iso2} className="border-b border-line last:border-b-0">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
              <input type="checkbox" className="size-5 accent-stamp-red" checked={picked.has(c.iso2)} onChange={() => toggle(c.iso2)} />
              <Flag iso2={c.iso2} size="xs" label="" />
              <span className="text-[0.95rem] text-ink">{c.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {save.error && (
        <p role="alert" className="mt-3 text-sm text-stamp-red">
          {save.error}
        </p>
      )}
    </BottomSheet>
  );
}
