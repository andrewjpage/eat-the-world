"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Button, Card, Eyebrow, useToast } from "@/components/ui";
import { saveRsvp } from "./rsvp";
import { DEFAULT_PLAN_TIME, londonToInstant } from "./logic";

interface Pick {
  id: string;
  name: string;
  address: string | null;
}

/** Strip characters that have meaning in a PostgREST ilike filter. */
function likeTerm(q: string): string {
  return q.replace(/[%_\\,()*]/g, " ").trim();
}

const todayLondon = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );

/**
 * Plan a dinner: restaurant (search or preselected), a London date and time. From Spin the
 * restaurant and a date (?date=, or next Friday) arrive filled in: one tap to plan.
 */
export function PlanForm({
  groupId,
  userId,
  initial,
  initialDate = "",
}: {
  groupId: string;
  userId: string;
  initial: Pick | null;
  /** YYYY-MM-DD (London) to prefill. */
  initialDate?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [picked, setPicked] = useState<Pick | null>(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Pick[]>([]);
  const [searching, setSearching] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(DEFAULT_PLAN_TIME);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = likeTerm(query);
    if (term.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await createClient()
        .from("restaurants")
        .select("id, name, address")
        .in("status", ["active", "reported_closed"])
        .ilike("name", `%${term}%`)
        .order("name")
        .limit(8);
      if (mine === seq.current) {
        setResults((data ?? []) as Pick[]);
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!picked) return setError("Pick a restaurant first.");
    if (!date) return setError("Pick a date.");
    const when = londonToInstant(date, time);
    if (!when) return setError("That date and time isn't valid in London. Try another.");
    if (when.getTime() < Date.now()) return setError("That time has already passed.");
    setSaving(true);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("plans")
      .insert({ group_id: groupId, restaurant_id: picked.id, proposed_by: userId, proposed_for: when.toISOString() })
      .select("id")
      .single();
    if (err || !data) {
      setSaving(false);
      setError("Couldn't save the plan. Check your connection and try again.");
      return;
    }
    // The proposer is in, unless they say otherwise.
    await saveRsvp(supabase, data.id, userId, "yes");
    toast("Dinner planned. Tell the group!", "success");
    router.push(`/group/${groupId}`);
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-5" data-testid="plan-form">
      <section aria-labelledby="where-h">
        <Eyebrow id="where-h" className="mb-2 px-1">
          Where
        </Eyebrow>
        {picked ? (
          <Card className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-display text-lg text-ink" data-testid="picked-restaurant">
                {picked.name}
              </p>
              {picked.address && <p className="truncate text-xs text-muted">{picked.address}</p>}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Change
            </Button>
          </Card>
        ) : (
          <div>
            <label htmlFor="plan-search" className="sr-only">
              Search restaurants
            </label>
            <input
              id="plan-search"
              type="search"
              className="input"
              placeholder="Search by name"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="mt-2 space-y-2" aria-live="polite">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(r)}
                    className="min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 py-2 text-left active:bg-paper-sunk"
                  >
                    <span className="block font-semibold text-ink">{r.name}</span>
                    {r.address && <span className="block truncate text-xs text-muted">{r.address}</span>}
                  </button>
                </li>
              ))}
              {!searching && likeTerm(query).length >= 2 && results.length === 0 && (
                <li className="px-1 text-sm text-muted">Nothing matches. Try another spelling.</li>
              )}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="when-h">
        <Eyebrow id="when-h" className="mb-2 px-1">
          When (London time)
        </Eyebrow>
        <div className="grid grid-cols-[3fr_2fr] gap-3">
          <div>
            <label htmlFor="plan-date" className="sr-only">
              Date
            </label>
            <input
              id="plan-date"
              type="date"
              className="input"
              min={todayLondon()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="plan-time" className="sr-only">
              Time
            </label>
            <input
              id="plan-time"
              type="time"
              className="input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
            />
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-2xl bg-stamp-red-soft px-4 py-2.5 text-[0.95rem] text-ink">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" block loading={saving}>
        Plan the dinner
      </Button>
    </form>
  );
}
