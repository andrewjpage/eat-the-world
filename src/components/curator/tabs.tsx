import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/countries";
import { mapsUrl } from "@/lib/maps-url";
import { Button, Card, EmptyState, Eyebrow } from "@/components/ui";
import { formatDate } from "@/components/restaurant/format";
import { SubmissionCard, type SubmissionView } from "./SubmissionCard";
import { ClosureCard, type ClosureView } from "./ClosureCard";
import { RestaurantsPanel, type RestaurantRow } from "./RestaurantsPanel";
import { CityCountryList, type CityCountryRow } from "./CityCountryList";
import { SetsEditor, type SetRow } from "./SetsEditor";
import { DishesEditor, type DishRow } from "./DishesEditor";
import type { CountryOption } from "./logic";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface CuratorCtx {
  supabase: Supabase;
  cityId: string;
  cityName: string;
  countries: (CountryOption & { iso_name: string | null })[];
  /** London status per country from city_country_status. */
  status: Map<string, { status: string; count: number }>;
}

const countryName = (ctx: CuratorCtx, iso: string) => ctx.countries.find((c) => c.iso2 === iso)?.name ?? iso;

async function namesFor(supabase: Supabase, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  // RLS lets a curator read only people they share a group with; anyone else shows as "a friend".
  const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", unique);
  for (const p of data ?? []) out.set(p.user_id, p.display_name);
  return out;
}

// ---------------------------------------------------------------------------

export async function SubmissionsTab({ ctx }: { ctx: CuratorCtx }) {
  const { data } = await ctx.supabase
    .from("submissions")
    .select("id, name, address, postcode, note, website, google_place_id, country_iso2, submitted_by, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  const names = await namesFor(ctx.supabase, rows.map((r) => r.submitted_by));

  const views: SubmissionView[] = rows.map((r) => {
    const cn = countryName(ctx, r.country_iso2);
    const st = ctx.status.get(r.country_iso2);
    const count = st?.count ?? 0;
    const willList = count === 0;
    return {
      id: r.id,
      name: r.name,
      address: r.address,
      postcode: r.postcode,
      note: r.note,
      website: r.website,
      mapHref: mapsUrl({ name: r.name, address: r.address ?? r.postcode, google_place_id: r.google_place_id }),
      iso2: r.country_iso2,
      countryName: cn,
      submitter: names.get(r.submitted_by) ?? "a friend",
      when: formatDate(r.created_at),
      willList,
      impact: willList
        ? `Approving makes ${cn} listed in ${ctx.cityName} (now ${st?.status ?? "unlisted"}), so it joins everyone's Gaps and Spin.`
        : `${cn} is already listed with ${count} restaurant${count === 1 ? "" : "s"}. Approving adds one more.`,
    };
  });

  if (views.length === 0) {
    return (
      <Card tone="sunk">
        <EmptyState emoji="📬" title="Nothing waiting" className="py-4">
          New suggestions from the group land here.
        </EmptyState>
      </Card>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {views.map((v) => (
        <li key={v.id}>
          <SubmissionCard s={v} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

export async function ClosuresTab({ ctx }: { ctx: CuratorCtx }) {
  const { data } = await ctx.supabase
    .from("closure_reports")
    .select("id, note, reported_by, created_at, restaurants(id, name, postcode, status, country_iso2)")
    .eq("resolved", false)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as unknown as {
    id: string;
    note: string | null;
    reported_by: string | null;
    created_at: string;
    restaurants: { id: string; name: string; postcode: string; status: ClosureView["status"]; country_iso2: string } | null;
  }[];
  const names = await namesFor(ctx.supabase, rows.map((r) => r.reported_by));

  const views: ClosureView[] = rows
    .filter((r) => r.restaurants)
    .map((r) => {
      const rest = r.restaurants!;
      return {
        reportId: r.id,
        restaurantId: rest.id,
        restaurantName: rest.name,
        postcode: rest.postcode,
        status: rest.status,
        countryName: countryName(ctx, rest.country_iso2),
        eligibleCount: ctx.status.get(rest.country_iso2)?.count ?? 0,
        note: r.note,
        reporter: (r.reported_by && names.get(r.reported_by)) || "a friend",
        when: formatDate(r.created_at),
      };
    });

  if (views.length === 0) {
    return (
      <Card tone="sunk">
        <EmptyState emoji="🔔" title="No open reports" className="py-4">
          When someone taps Report closed on a restaurant, it shows up here.
        </EmptyState>
      </Card>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {views.map((v) => (
        <li key={v.reportId}>
          <ClosureCard c={v} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

const LIMIT = 40;

export async function RestaurantsTab({ ctx, q }: { ctx: CuratorCtx; q: string }) {
  // Strip characters that mean something in a PostgREST filter or an ilike pattern.
  const term = q.replace(/[,()*%_\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  let query = ctx.supabase
    .from("restaurants")
    .select("id, name, address, postcode, country_iso2, status, confidence, curator_note, google_place_id, website, verified_at")
    .eq("city_id", ctx.cityId)
    .order("name")
    .limit(LIMIT);
  if (term) query = query.or(`name.ilike.%${term}%,postcode.ilike.%${term}%`);
  const { data } = await query;
  const rows = (data ?? []) as RestaurantRow[];

  const eligibleCounts: Record<string, number> = {};
  for (const [iso, s] of ctx.status) if (s.count > 0) eligibleCounts[iso] = s.count;
  const options: CountryOption[] = ctx.countries.map((c) => ({ iso2: c.iso2, name: c.name }));

  return (
    <>
      <form action="/curator" method="get" className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="tab" value="restaurants" />
        <label htmlFor="r-q" className="sr-only">
          Search restaurants
        </label>
        <input id="r-q" name="q" type="search" defaultValue={term} className="input" placeholder="Name or postcode" autoComplete="off" />
        <Button type="submit" className="shrink-0">
          Search
        </Button>
      </form>
      {rows.length === 0 ? (
        <Card tone="sunk">
          <EmptyState emoji="🔎" title="No matches" className="py-4">
            Try part of the name, or a postcode like N1.
          </EmptyState>
        </Card>
      ) : (
        <>
          <RestaurantsPanel rows={rows} countries={options} eligibleCounts={eligibleCounts} />
          {rows.length === LIMIT && (
            <p className="mt-3 text-center text-sm text-muted">Showing the first {LIMIT}. Search to narrow it down.</p>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export function CityStatusTab({ ctx }: { ctx: CuratorCtx }) {
  const rows: CityCountryRow[] = [];
  for (const c of ctx.countries) {
    const s = ctx.status.get(c.iso2);
    if (!s || s.count > 0) continue;
    rows.push({ iso2: c.iso2, name: c.name, status: s.status === "uncharted" ? "uncharted" : "unlisted" });
  }
  return <CityCountryList rows={rows} city={ctx.cityName} />;
}

// ---------------------------------------------------------------------------

export async function SetsTab({ ctx }: { ctx: CuratorCtx }) {
  const { data } = await ctx.supabase.from("sets").select("id, slug, name, country_iso2s").order("name");
  const sets: SetRow[] = (data ?? []).map((s) => ({ id: s.id, slug: s.slug, name: s.name, countries: s.country_iso2s ?? [] }));
  const options: CountryOption[] = ctx.countries.map((c) => ({ iso2: c.iso2, name: c.name }));
  return <SetsEditor sets={sets} countries={options} />;
}

// ---------------------------------------------------------------------------

export async function DishesTab({ ctx, country }: { ctx: CuratorCtx; country: string }) {
  const { data: all } = await ctx.supabase.from("signature_dishes").select("country_iso2, status");
  const counts = new Map<string, { total: number; drafts: number }>();
  for (const d of all ?? []) {
    const c = counts.get(d.country_iso2) ?? { total: 0, drafts: 0 };
    c.total += 1;
    if (d.status === "draft") c.drafts += 1;
    counts.set(d.country_iso2, c);
  }

  const selected = ctx.countries.find((c) => c.iso2 === country) ?? null;
  let dishes: DishRow[] = [];
  if (selected) {
    const { data } = await ctx.supabase
      .from("signature_dishes")
      .select("id, name, note, status")
      .eq("country_iso2", selected.iso2)
      .order("name");
    dishes = (data ?? []) as DishRow[];
  }

  const withDishes = ctx.countries.filter((c) => counts.has(c.iso2));

  return (
    <>
      <form action="/curator" method="get" className="mb-4 flex gap-2">
        <input type="hidden" name="tab" value="dishes" />
        <label htmlFor="d-country" className="sr-only">
          Country
        </label>
        <select id="d-country" name="country" className="input" defaultValue={selected?.iso2 ?? ""}>
          <option value="" disabled>
            Pick a country
          </option>
          {ctx.countries.map((c) => (
            <option key={c.iso2} value={c.iso2}>
              {c.name}
              {counts.has(c.iso2) ? ` (${counts.get(c.iso2)!.total})` : ""}
            </option>
          ))}
        </select>
        <Button type="submit" className="shrink-0">
          Show
        </Button>
      </form>

      {selected ? (
        <DishesEditor key={selected.iso2} iso2={selected.iso2} countryName={displayName(selected)} dishes={dishes} />
      ) : (
        <>
          <Eyebrow className="mb-2">Countries with dishes</Eyebrow>
          <ul className="flex flex-wrap gap-2">
            {withDishes.map((c) => {
              const n = counts.get(c.iso2)!;
              return (
                <li key={c.iso2}>
                  <Link
                    href={`/curator?tab=dishes&country=${c.iso2}`}
                    prefetch={false}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-paper-raised px-3.5 text-sm font-semibold text-ink"
                  >
                    {c.name}
                    <span className="font-mono text-xs text-muted">
                      {n.total}
                      {n.drafts > 0 ? ` · ${n.drafts} draft` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
